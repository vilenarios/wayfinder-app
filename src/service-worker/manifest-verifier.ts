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

  for (const gateway of gateways) {
    const gatewayBase = gateway.replace(/\/+$/, '');
    const rawUrl = `${gatewayBase}/raw/${txId}`;

    try {
      const response = await fetch(rawUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const rawData = await response.arrayBuffer();

      // Check if it's a manifest by content-type
      if (contentType.includes('application/x.arweave-manifest+json')) {
        const text = new TextDecoder().decode(rawData);
        const manifest = JSON.parse(text) as ArweaveManifest;
        logger.debug(TAG, `Manifest detected: ${Object.keys(manifest.paths).length} paths`);
        return { isManifest: true, manifest, rawData, contentType, workingGateway: gatewayBase };
      }

      // Try parsing as JSON manifest
      try {
        const text = new TextDecoder().decode(rawData);
        const parsed = JSON.parse(text);
        if (parsed.manifest === 'arweave/paths' && parsed.paths) {
          const manifest = parsed as ArweaveManifest;
          logger.debug(TAG, `Manifest detected: ${Object.keys(manifest.paths).length} paths`);
          return { isManifest: true, manifest, rawData, contentType, workingGateway: gatewayBase };
        }
      } catch {
        // Not JSON, not a manifest
      }

      logger.debug(TAG, 'Single file mode');
      return { isManifest: false, rawData, contentType, workingGateway: gatewayBase };

    } catch (error) {
      logger.debug(TAG, `Gateway failed: ${new URL(gatewayBase).hostname}`);
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`All gateways failed. Last error: ${lastError?.message}`);
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

    const promise = verifyAndCacheResource(identifier, entry.id, path)
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

    const { isManifest, manifest, workingGateway } = await fetchAndCheckManifest(txId, routingGateways);

    setSelectedGateway(workingGateway);

    broadcastEvent({
      type: 'routing-gateway',
      identifier,
      manifestTxId: txId,
      gatewayUrl: workingGateway,
    });

    if (!isManifest) {
      const singleFileManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.2.0',
        index: { path: 'index' },
        paths: { 'index': { id: txId } },
      };

      setManifestLoaded(identifier, singleFileManifest);
      await verifyAndCacheResource(identifier, txId, 'index');
      return;
    }

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
 */
export function getVerifiedContent(
  identifier: string,
  path: string
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

  return verifiedCache.toResponse(resource);
}
