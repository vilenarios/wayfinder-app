/**
 * Manifest-first verification orchestrator.
 *
 * Handles the complete flow:
 * 1. Resolve ArNS name to txId (or use txId directly)
 * 2. Fetch raw content and check if it's a manifest
 * 3. If manifest: pre-verify all resources
 * 4. Cache verified content
 * 5. Serve from cache
 */

import type { ArweaveManifest, ManifestCheckResult, WayfinderConfig } from './types';
import { verifiedCache } from './verified-cache';
import {
  startManifestVerification,
  setResolvedTxId,
  setManifestLoaded,
  recordResourceVerified,
  recordResourceFailed,
  failVerification,
  getManifestState,
  broadcastEvent,
} from './verification-state';
import { getWayfinder, isWayfinderReady, setSelectedGateway } from './wayfinder-instance';

// Default concurrency limit for parallel verification
const DEFAULT_CONCURRENCY = 10;

// Current concurrency setting (can be updated via config)
let maxConcurrentVerifications = DEFAULT_CONCURRENCY;

/**
 * Set the concurrency limit for parallel resource verification.
 */
export function setVerificationConcurrency(concurrency: number): void {
  maxConcurrentVerifications = Math.max(1, Math.min(20, concurrency)); // Clamp between 1-20
  console.log(`[Verifier] Concurrency set to ${maxConcurrentVerifications}`);
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

  console.log(`[Verifier] Resolving ArNS "${arnsName}" via ${trustedGateways.length} trusted gateways`);

  // Query all trusted gateways in parallel using subdomain format
  const results = await Promise.allSettled(
    trustedGateways.map(async (gateway) => {
      // Parse the gateway URL to extract the host
      const gatewayUrl = new URL(gateway);
      // ArNS uses subdomain format: {arnsName}.{gateway-host}
      const arnsUrl = `https://${arnsName}.${gatewayUrl.host}`;

      console.log(`[Verifier] HEAD request to: ${arnsUrl}`);

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

  // Collect successful results
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
    throw new Error(`All trusted gateways failed to resolve ArNS "${arnsName}": ${errors.join(', ')}`);
  }

  // Check for consensus - all successful responses must agree
  const txIds = successful.map(r => r.txId);
  const uniqueTxIds = [...new Set(txIds)];

  if (uniqueTxIds.length > 1) {
    console.error(`[Verifier] ArNS resolution mismatch for "${arnsName}":`,
      successful.map(s => `${new URL(s.gateway).hostname}=${s.txId.slice(0, 8)}`));
    throw new Error(
      `ArNS resolution mismatch: trusted gateways disagree on txId for "${arnsName}". ` +
      `This may indicate a security issue.`
    );
  }

  const resolvedTxId = uniqueTxIds[0];
  const usedGateway = successful[0].gateway;

  console.log(`[Verifier] ArNS "${arnsName}" resolved to ${resolvedTxId} (${successful.length}/${trustedGateways.length} gateways agreed)`);

  return { txId: resolvedTxId, gateway: usedGateway };
}

/**
 * Fetch RAW content from gateways to check if it's a manifest.
 * Tries gateways one by one until one succeeds.
 * Returns the working gateway so all resources can use the same one.
 */
export async function fetchAndCheckManifest(
  txId: string,
  gateways: string[]
): Promise<ManifestCheckResult & { workingGateway: string }> {
  if (gateways.length === 0) {
    throw new Error('No gateways available for manifest fetch');
  }

  let lastError: Error | null = null;

  // Try each gateway until one works
  for (const gateway of gateways) {
    // Remove trailing slash to avoid double slashes in URL
    const gatewayBase = gateway.replace(/\/+$/, '');
    const rawUrl = `${gatewayBase}/raw/${txId}`;
    console.log(`[Verifier] Trying to fetch manifest from: ${rawUrl}`);

    try {
      const response = await fetch(rawUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const rawData = await response.arrayBuffer();

      console.log(`[Verifier] Successfully fetched from ${new URL(gatewayBase).hostname}: ${contentType}, ${rawData.byteLength} bytes`);

      // Check if it's a manifest by content-type
      if (contentType.includes('application/x.arweave-manifest+json')) {
        const text = new TextDecoder().decode(rawData);
        const manifest = JSON.parse(text) as ArweaveManifest;
        console.log(`[Verifier] Detected manifest (by content-type): ${Object.keys(manifest.paths).length} paths`);
        return { isManifest: true, manifest, rawData, contentType, workingGateway: gatewayBase };
      }

      // Try parsing as JSON manifest
      try {
        const text = new TextDecoder().decode(rawData);
        const parsed = JSON.parse(text);
        if (parsed.manifest === 'arweave/paths' && parsed.paths) {
          const manifest = parsed as ArweaveManifest;
          console.log(`[Verifier] Detected manifest (by structure): ${Object.keys(manifest.paths).length} paths`);
          return { isManifest: true, manifest, rawData, contentType, workingGateway: gatewayBase };
        }
      } catch {
        // Not JSON, not a manifest
      }

      console.log(`[Verifier] Not a manifest - single file mode`);
      return { isManifest: false, rawData, contentType, workingGateway: gatewayBase };

    } catch (error) {
      console.warn(`[Verifier] Gateway ${new URL(gatewayBase).hostname} failed:`, error);
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next gateway
    }
  }

  throw new Error(`All gateways failed to fetch manifest. Last error: ${lastError?.message}`);
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

  // Check if already cached
  if (verifiedCache.has(txId)) {
    console.log(`[Verifier] Already cached: ${path} (${txId.slice(0, 8)}...)`);
    recordResourceVerified(identifier, txId, path);
    return;
  }

  const wayfinder = getWayfinder();
  const arUrl = `ar://${txId}`;

  console.log(`[Verifier] Verifying: ${path} → ${arUrl}`);

  try {
    console.log(`[Verifier] Calling wayfinder.request for: ${arUrl}`);
    const response = await wayfinder.request(arUrl);
    console.log(`[Verifier] Got response for ${path}, status: ${response.status}`);

    // Read the full response body
    const data = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    console.log(`[Verifier] Read ${data.byteLength} bytes for ${path}, contentType: ${contentType}`);

    // Extract headers for caching
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Cache the verified resource
    verifiedCache.set(txId, {
      contentType,
      data,
      headers,
    });
    console.log(`[Verifier] Cached ${path} (txId: ${txId.slice(0, 8)}...)`);

    // Record success - if we got here without throwing, hash verification passed
    recordResourceVerified(identifier, txId, path);

  } catch (error) {
    // Record failure - Wayfinder throws if hash verification fails (in strict mode)
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Verifier] FAILED to verify ${path}:`, errorMsg);
    recordResourceFailed(identifier, txId, path, errorMsg);
    throw error;
  }
}

/**
 * Verify all resources in a manifest with concurrency control.
 */
async function verifyAllResources(
  identifier: string,
  manifest: ArweaveManifest
): Promise<void> {
  const entries = Object.entries(manifest.paths);

  // Add fallback if present
  if (manifest.fallback?.id) {
    entries.push(['__fallback__', { id: manifest.fallback.id }]);
  }

  console.log(`[Verifier] Verifying ${entries.length} resources with concurrency ${maxConcurrentVerifications}`);

  // Track active and all promises separately for proper concurrency control
  const allResults: Promise<void>[] = [];
  const activePromises = new Set<Promise<void>>();

  for (const [path, entry] of entries) {
    // Wait if we're at the concurrency limit
    while (activePromises.size >= maxConcurrentVerifications) {
      await Promise.race(activePromises);
    }

    // Create the verification promise
    const promise = verifyAndCacheResource(identifier, entry.id, path)
      .catch(error => {
        // Errors already recorded via Wayfinder callback
        console.error(`[Verifier] Failed to verify ${path}:`, error);
      });

    // Track this promise and remove when done
    activePromises.add(promise);
    promise.finally(() => {
      activePromises.delete(promise);
    });

    allResults.push(promise);
  }

  // Wait for all to complete
  await Promise.allSettled(allResults);

  console.log(`[Verifier] All resources processed for "${identifier}"`);
}

/**
 * Main entry point: verify an identifier (ArNS name or txId).
 * Returns when verification is complete.
 */
export async function verifyIdentifier(
  identifier: string,
  config: WayfinderConfig
): Promise<void> {
  // Start tracking
  startManifestVerification(identifier);

  try {
    let txId: string;

    // Step 1: Resolve to txId
    if (isTxId(identifier)) {
      // Direct txId - no resolution needed
      txId = identifier;
      setResolvedTxId(identifier, txId);
    } else {
      // ArNS name - resolve via TRUSTED gateways (not routing gateways)
      // This ensures consensus and prevents malicious redirection
      const resolved = await resolveArnsToTxId(identifier, config.trustedGateways);
      txId = resolved.txId;
      setResolvedTxId(identifier, txId, resolved.gateway);
    }

    // Get routing gateways to try for manifest fetch
    const routingGateways = config.routingGateways && config.routingGateways.length > 0
      ? config.routingGateways
      : config.trustedGateways;

    // Step 2: Fetch RAW content to check if it's a manifest
    // Try gateways until one works, then use that gateway for all resources
    const { isManifest, manifest, workingGateway } = await fetchAndCheckManifest(txId, routingGateways);

    // Use the working gateway for all subsequent resource fetches
    setSelectedGateway(workingGateway);
    console.log(`[Verifier] Using gateway ${new URL(workingGateway).hostname} for all resources`);

    // Broadcast gateway info
    broadcastEvent({
      type: 'routing-gateway',
      identifier,
      manifestTxId: txId,
      gatewayUrl: workingGateway,
    });

    if (!isManifest) {
      // Single file - need to verify through Wayfinder
      console.log(`[Verifier] Single file mode for "${identifier}"`);

      // Create minimal manifest state for single file
      const singleFileManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.2.0',
        index: { path: 'index' },
        paths: { 'index': { id: txId } },
      };

      // Set up state, then verify the single file through Wayfinder
      setManifestLoaded(identifier, singleFileManifest);
      await verifyAndCacheResource(identifier, txId, 'index');
      return;
    }

    // Step 3: Load manifest
    setManifestLoaded(identifier, manifest!);

    // Step 4: Verify all resources using the same gateway
    await verifyAllResources(identifier, manifest!);

    console.log(`[Verifier] Verification complete for "${identifier}"`);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    failVerification(identifier, errorMsg);
    throw error;
  } finally {
    // Clear selected gateway so next manifest can pick fresh
    setSelectedGateway(null);
  }
}

/**
 * Get verified content for a path.
 * Returns null if not found or not verified.
 * Works for 'complete' and 'partial' status (serves verified resources even if some failed).
 */
export function getVerifiedContent(
  identifier: string,
  path: string
): Response | null {
  const state = getManifestState(identifier);
  if (!state || (state.status !== 'complete' && state.status !== 'partial')) {
    return null;
  }

  // Normalize path
  let normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  if (normalizedPath === '') {
    // Root path - use index
    normalizedPath = state.indexPath;
  } else if (normalizedPath.endsWith('/')) {
    // Directory path - append index (e.g., "foo/" -> "foo/index.html")
    normalizedPath = normalizedPath + state.indexPath;
  }

  console.log(`[Verifier] Looking up path: "${normalizedPath}" (original: "${path}")`);

  // Look up txId for this path
  const txId = state.pathToTxId.get(normalizedPath);
  console.log(`[Verifier] Found txId: ${txId ? txId.slice(0, 8) + '...' : 'NOT FOUND'}`);

  if (!txId) {
    console.log(`[Verifier] Available paths in manifest:`, Array.from(state.pathToTxId.keys()).slice(0, 20));
  }
  if (!txId) {
    // Try fallback
    const fallbackId = state.pathToTxId.get('__fallback__');
    if (fallbackId) {
      const resource = verifiedCache.get(fallbackId);
      if (resource) {
        return verifiedCache.toResponse(resource);
      }
    }
    console.warn(`[Verifier] Path not found in manifest: ${path}`);
    return null;
  }

  // Get from cache
  const resource = verifiedCache.get(txId);
  if (!resource) {
    console.warn(`[Verifier] Resource not in cache: ${txId} (${path})`);
    return null;
  }

  return verifiedCache.toResponse(resource);
}
