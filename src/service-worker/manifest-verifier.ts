/**
 * Manifest-first verification orchestrator.
 *
 * SECURITY MODEL:
 * - ArNS names are resolved via trusted gateways with consensus checking
 * - Manifest content is cryptographically verified BEFORE trusting path->txId mappings
 * - All resources are verified against trusted gateways before serving
 *
 * Flow:
 * 1. Resolve ArNS name to txId via trusted gateways (consensus required)
 * 2. Select a responsive routing gateway
 * 3. Fetch AND VERIFY manifest content via Wayfinder (hash/signature check)
 * 4. Parse manifest only AFTER verification passes
 * 5. Verify all resources in manifest
 * 6. Serve only verified content from cache
 */

import type { ArweaveManifest, ManifestCheckResult, SwWayfinderConfig } from './types';
import { verifiedCache } from './verified-cache';
import {
  startManifestVerification,
  setResolvedTxId,
  setManifestLoaded,
  recordResourceVerified,
  recordResourceFailed,
  failVerification,
  completeVerification,
  getManifestState,
  broadcastEvent,
} from './verification-state';
import { getWayfinder, isWayfinderReady, setSelectedGateway } from './wayfinder-instance';
import { logger } from './logger';

const TAG = 'Verifier';

// Default concurrency limit for parallel verification
const DEFAULT_CONCURRENCY = 10;

// Current concurrency setting (can be updated via config)
let maxConcurrentVerifications = DEFAULT_CONCURRENCY;

/**
 * Set the concurrency limit for parallel resource verification.
 */
export function setVerificationConcurrency(concurrency: number): void {
  maxConcurrentVerifications = Math.max(1, Math.min(20, concurrency));
  logger.debug(TAG, `Concurrency: ${maxConcurrentVerifications}`);
}

// Detect if identifier is a 43-char Arweave transaction ID
const TX_ID_REGEX = /^[A-Za-z0-9_-]{43}$/;

function isTxId(identifier: string): boolean {
  return TX_ID_REGEX.test(identifier);
}

/**
 * Resolve an ArNS name to a transaction ID using trusted gateways.
 * Queries multiple trusted gateways and requires consensus to prevent
 * a malicious gateway from redirecting to different content.
 *
 * Uses subdomain format: {arnsName}.{gateway-host} (e.g., vilenarios.ar-io.dev)
 */
export async function resolveArnsToTxId(
  arnsName: string,
  trustedGateways: string[]
): Promise<{ txId: string; gateway: string }> {
  if (trustedGateways.length === 0) {
    throw new Error('No trusted gateways available for ArNS resolution');
  }

  logger.debug(TAG, `Resolving ArNS "${arnsName}" via ${trustedGateways.length} gateways`);

  const results = await Promise.allSettled(
    trustedGateways.map(async (gateway) => {
      const gatewayUrl = new URL(gateway);
      const arnsUrl = `https://${arnsName}.${gatewayUrl.host}`;

      const response = await fetch(arnsUrl, {
        method: 'HEAD',
        headers: { 'Accept': '*/*' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const txId = response.headers.get('x-arns-resolved-id');
      if (!txId) {
        throw new Error('No x-arns-resolved-id header');
      }

      return { txId, gateway: gateway.replace(/\/$/, '') };
    })
  );

  const successful = results
    .map((r, i) => ({ result: r, gateway: trustedGateways[i] }))
    .filter((r): r is { result: PromiseFulfilledResult<{ txId: string; gateway: string }>; gateway: string } =>
      r.result.status === 'fulfilled'
    )
    .map(r => r.result.value);

  if (successful.length === 0) {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason?.message || 'Unknown error');
    throw new Error(`All gateways failed to resolve ArNS "${arnsName}": ${errors.join(', ')}`);
  }

  const txIds = successful.map(r => r.txId);
  const uniqueTxIds = [...new Set(txIds)];

  if (uniqueTxIds.length > 1) {
    logger.error(TAG, `ArNS mismatch for "${arnsName}":`,
      successful.map(s => `${new URL(s.gateway).hostname}=${s.txId.slice(0, 8)}`));
    throw new Error(`ArNS resolution mismatch for "${arnsName}" - security issue`);
  }

  const resolvedTxId = uniqueTxIds[0];
  const usedGateway = successful[0].gateway;

  logger.debug(TAG, `ArNS "${arnsName}" → ${resolvedTxId.slice(0, 8)}...`);

  return { txId: resolvedTxId, gateway: usedGateway };
}

/**
 * Find a working gateway by trying each one until one responds.
 * This is a lightweight check (HEAD request) to find a responsive gateway
 * before committing to verified fetches.
 */
async function selectWorkingGateway(
  txId: string,
  gateways: string[]
): Promise<string> {
  if (gateways.length === 0) {
    throw new Error('No gateways available');
  }

  let lastError: Error | null = null;

  for (const gateway of gateways) {
    const gatewayBase = gateway.replace(/\/+$/, '');
    const rawUrl = `${gatewayBase}/raw/${txId}`;

    try {
      // Use HEAD request to check if gateway is responsive without downloading content
      const response = await fetch(rawUrl, { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      logger.debug(TAG, `Selected gateway: ${new URL(gatewayBase).hostname}`);
      return gatewayBase;

    } catch (error) {
      logger.debug(TAG, `Gateway failed: ${new URL(gatewayBase).hostname}`);
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`All gateways failed. Last error: ${lastError?.message}`);
}

/**
 * Compute SHA-256 hash of data and return as base64url string.
 */
async function computeHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  // Convert to base64url (Arweave format)
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Verify a computed hash against trusted gateways.
 * Fetches the hash from ONE trusted gateway (trying each until one succeeds).
 * This is more efficient than fetching from all gateways.
 *
 * Note: We only need ONE trusted gateway to agree because:
 * 1. The txId itself is content-addressed (hash of the data)
 * 2. If the routing gateway served wrong content, the hash won't match
 * 3. We're verifying our computed hash against a trusted source
 */
async function verifyHashAgainstTrustedGateway(
  txId: string,
  computedHash: string,
  trustedGateways: string[]
): Promise<void> {
  let lastError: Error | null = null;

  for (const gateway of trustedGateways) {
    const gatewayBase = gateway.replace(/\/+$/, '');

    try {
      // First try HEAD request to get hash from header (most efficient)
      const headResponse = await fetch(`${gatewayBase}/raw/${txId}`, { method: 'HEAD' });
      if (!headResponse.ok) {
        throw new Error(`HTTP ${headResponse.status}`);
      }

      // Try to get hash from header
      const hashHeader = headResponse.headers.get('x-ar-io-data-hash') ||
                         headResponse.headers.get('x-arweave-data-hash');

      if (hashHeader) {
        if (hashHeader === computedHash) {
          logger.debug(TAG, `Hash verified via header from ${new URL(gatewayBase).hostname}`);
          return; // Success!
        } else {
          throw new Error(`Hash mismatch: computed=${computedHash.slice(0, 12)}..., trusted=${hashHeader.slice(0, 12)}...`);
        }
      }

      // No hash header - need to fetch and hash the content
      const fullResponse = await fetch(`${gatewayBase}/raw/${txId}`);
      if (!fullResponse.ok) {
        throw new Error(`HTTP ${fullResponse.status}`);
      }

      const data = await fullResponse.arrayBuffer();
      const trustedHash = await computeHash(data);

      if (trustedHash === computedHash) {
        logger.debug(TAG, `Hash verified via content from ${new URL(gatewayBase).hostname}`);
        return; // Success!
      } else {
        throw new Error(`Hash mismatch: computed=${computedHash.slice(0, 12)}..., trusted=${trustedHash.slice(0, 12)}...`);
      }

    } catch (error) {
      logger.debug(TAG, `Trusted gateway ${new URL(gatewayBase).hostname} failed: ${error instanceof Error ? error.message : error}`);
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next gateway
    }
  }

  throw new Error(`All trusted gateways failed to verify hash. Last error: ${lastError?.message}`);
}

/**
 * Fetch and verify manifest/content from the selected routing gateway.
 *
 * SECURITY: This fetches RAW content (not resolved through manifest paths)
 * and verifies its hash against trusted gateways before trusting it.
 *
 * For manifests: We need the raw manifest JSON, not the resolved index.html.
 * For single files: The raw content IS the file content.
 */
async function fetchAndVerifyRawContent(
  txId: string,
  routingGateway: string,
  trustedGateways: string[]
): Promise<ManifestCheckResult> {
  const gatewayBase = routingGateway.replace(/\/+$/, '');
  const rawUrl = `${gatewayBase}/raw/${txId}`;

  logger.debug(TAG, `Fetching raw content: ${txId.slice(0, 8)}... from ${new URL(gatewayBase).hostname}`);

  // Fetch raw content from routing gateway
  const response = await fetch(rawUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch raw content: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const rawData = await response.arrayBuffer();

  // Compute hash of fetched content
  const computedHash = await computeHash(rawData);
  logger.debug(TAG, `Computed hash: ${computedHash.slice(0, 12)}...`);

  // Verify hash against trusted gateways
  await verifyHashAgainstTrustedGateway(txId, computedHash, trustedGateways);

  logger.debug(TAG, `Verified: ${txId.slice(0, 8)}...`);

  // Cache the verified content
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  verifiedCache.set(txId, { contentType, data: rawData, headers });

  // Check if it's a manifest by content-type
  if (contentType.includes('application/x.arweave-manifest+json')) {
    const text = new TextDecoder().decode(rawData);
    const manifest = JSON.parse(text) as ArweaveManifest;
    logger.debug(TAG, `Manifest detected: ${Object.keys(manifest.paths).length} paths`);
    return { isManifest: true, manifest, rawData, contentType };
  }

  // Try parsing as JSON manifest (some may not have correct content-type)
  try {
    const text = new TextDecoder().decode(rawData);
    const parsed = JSON.parse(text);
    if (parsed.manifest === 'arweave/paths' && parsed.paths) {
      const manifest = parsed as ArweaveManifest;
      logger.debug(TAG, `Manifest detected: ${Object.keys(manifest.paths).length} paths`);
      return { isManifest: true, manifest, rawData, contentType };
    }
  } catch {
    // Not JSON, not a manifest
  }

  logger.debug(TAG, 'Single file mode');
  return { isManifest: false, rawData, contentType };
}

/**
 * Verify and cache a single resource by txId.
 * Records verification success/failure directly (not via Wayfinder callbacks).
 */
async function verifyAndCacheResource(
  identifier: string,
  txId: string,
  path: string
): Promise<void> {
  if (!isWayfinderReady()) {
    throw new Error('Wayfinder not ready');
  }

  if (verifiedCache.has(txId)) {
    recordResourceVerified(identifier, txId, path);
    return;
  }

  const wayfinder = getWayfinder();
  const arUrl = `ar://${txId}`;

  try {
    const response = await wayfinder.request(arUrl);
    const data = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    verifiedCache.set(txId, { contentType, data, headers });
    recordResourceVerified(identifier, txId, path);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(TAG, `Failed: ${path} - ${errorMsg}`);
    recordResourceFailed(identifier, txId, path, errorMsg);
    throw error;
  }
}

/**
 * Verify all resources in a manifest with concurrency control.
 * Returns true if manifest was empty (caller should trigger completion).
 */
async function verifyAllResources(
  identifier: string,
  manifest: ArweaveManifest
): Promise<boolean> {
  const entries = Object.entries(manifest.paths);

  if (manifest.fallback?.id) {
    entries.push(['__fallback__', { id: manifest.fallback.id }]);
  }

  // Handle empty manifest - return true so caller triggers completion
  if (entries.length === 0) {
    logger.info(TAG, 'Empty manifest');
    return true;
  }

  logger.info(TAG, `Verifying ${entries.length} resources`);

  const allResults: Promise<void>[] = [];
  const activePromises = new Set<Promise<void>>();

  for (const [path, entry] of entries) {
    while (activePromises.size >= maxConcurrentVerifications) {
      await Promise.race(activePromises);
    }

    // Handle both formats: { id: string } and raw string txId
    const txId = typeof entry === 'string' ? entry : entry.id;
    const promise = verifyAndCacheResource(identifier, txId, path)
      .catch(() => { /* Errors already logged */ });

    activePromises.add(promise);
    promise.finally(() => activePromises.delete(promise));
    allResults.push(promise);
  }

  await Promise.allSettled(allResults);
  return false;
}

/**
 * Main entry point: verify an identifier (ArNS name or txId).
 * Returns when verification is complete.
 */
export async function verifyIdentifier(
  identifier: string,
  config: SwWayfinderConfig
): Promise<void> {
  startManifestVerification(identifier);

  try {
    let txId: string;

    if (isTxId(identifier)) {
      txId = identifier;
      setResolvedTxId(identifier, txId);
    } else {
      const resolved = await resolveArnsToTxId(identifier, config.trustedGateways);
      txId = resolved.txId;
      setResolvedTxId(identifier, txId, resolved.gateway);
    }

    const routingGateways = config.routingGateways && config.routingGateways.length > 0
      ? config.routingGateways
      : config.trustedGateways;

    // Shuffle gateways for load distribution and to avoid always hitting the same gateway on retry
    const shuffledGateways = [...routingGateways];
    for (let i = shuffledGateways.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledGateways[i], shuffledGateways[j]] = [shuffledGateways[j], shuffledGateways[i]];
    }

    // Step 1: Find a responsive gateway (lightweight HEAD request)
    const workingGateway = await selectWorkingGateway(txId, shuffledGateways);

    // Step 2: Lock in this gateway for all subsequent requests
    setSelectedGateway(workingGateway);

    broadcastEvent({
      type: 'routing-gateway',
      identifier,
      manifestTxId: txId,
      gatewayUrl: workingGateway,
    });

    // Step 3: Fetch AND VERIFY the raw manifest/content
    // SECURITY: This fetches raw content (not resolved through manifest paths)
    // and verifies its hash against trusted gateways before trusting it.
    // This prevents a malicious routing gateway from serving a forged manifest.
    const { isManifest, manifest } = await fetchAndVerifyRawContent(
      txId,
      workingGateway,
      config.trustedGateways
    );

    if (!isManifest) {
      // Single file - already verified and cached by fetchAndVerifyRawContent
      // We create a synthetic manifest structure to reuse the same serving code,
      // but mark it as isSingleFile so we don't try to intercept absolute paths
      const singleFileManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.2.0',
        index: { path: 'index' },
        paths: { 'index': { id: txId } },
      };

      setManifestLoaded(identifier, singleFileManifest, true /* isSingleFile */);
      // Record as verified - this triggers completeVerification automatically
      // since verifiedResources (1) >= totalResources (1)
      recordResourceVerified(identifier, txId, 'index');
      return;
    }

    // Manifest case - manifest itself is now verified, proceed to verify resources
    setManifestLoaded(identifier, manifest!);
    const wasEmpty = await verifyAllResources(identifier, manifest!);

    // For empty manifests, manually trigger completion since no resources will do it
    if (wasEmpty) {
      completeVerification(identifier);
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    failVerification(identifier, errorMsg);
    throw error;
  } finally {
    setSelectedGateway(null);
  }
}

/**
 * Get verified content for a path.
 * Returns null if not found or not verified.
 * Works for 'complete' and 'partial' status (serves verified resources even if some failed).
 *
 * @param identifier - The ArNS name or txId
 * @param path - The resource path within the manifest
 * @param injectLocationPatch - Optional function to patch HTML content with location override
 */
export function getVerifiedContent(
  identifier: string,
  path: string,
  injectLocationPatch?: (html: string, identifier: string, gatewayUrl: string) => string
): Response | null {
  const state = getManifestState(identifier);
  if (!state || (state.status !== 'complete' && state.status !== 'partial')) {
    return null;
  }

  let normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  if (normalizedPath === '') {
    normalizedPath = state.indexPath;
  } else if (normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath + state.indexPath;
  }

  const txId = state.pathToTxId.get(normalizedPath);

  if (!txId) {
    const fallbackId = state.pathToTxId.get('__fallback__');
    if (fallbackId) {
      const resource = verifiedCache.get(fallbackId);
      if (resource) {
        return verifiedCache.toResponse(resource);
      }
    }
    return null;
  }

  const resource = verifiedCache.get(txId);
  if (!resource) {
    logger.warn(TAG, `Cache miss: ${txId.slice(0, 8)}...`);
    return null;
  }

  // If this is HTML and we have a location patcher, inject the patch
  if (injectLocationPatch && state.routingGateway) {
    const contentType = resource.contentType.toLowerCase();
    if (contentType.includes('text/html')) {
      try {
        const html = new TextDecoder().decode(resource.data);
        const patchedHtml = injectLocationPatch(html, identifier, state.routingGateway);
        const patchedData = new TextEncoder().encode(patchedHtml);

        // Create response with patched content
        const headers = new Headers();
        Object.entries(resource.headers).forEach(([key, value]) => {
          headers.set(key, value);
        });
        if (!headers.has('content-type')) {
          headers.set('content-type', resource.contentType);
        }
        headers.set('x-wayfinder-verified', 'true');
        headers.set('x-wayfinder-verified-at', resource.verifiedAt.toString());
        headers.set('x-wayfinder-location-patched', 'true');

        return new Response(patchedData, {
          status: 200,
          headers,
        });
      } catch (e) {
        logger.warn(TAG, `Failed to patch HTML: ${e}`);
        // Fall through to return unpatched response
      }
    }
  }

  return verifiedCache.toResponse(resource);
}
