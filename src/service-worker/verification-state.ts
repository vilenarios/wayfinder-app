/**
 * Manifest-aware verification state tracker.
 *
 * Tracks the full lifecycle of manifest verification:
 * - Resolution (ArNS → txId)
 * - Manifest fetching and parsing
 * - Pre-verification of all resources
 * - Completion status
 */

import type { ArweaveManifest, ManifestVerificationState, VerificationEvent } from './types';
import { logger } from './logger';

declare const self: ServiceWorkerGlobalScope;

const TAG = 'State';

// Active manifest verifications keyed by identifier (ArNS name or txId)
const manifestStates = new Map<string, ManifestVerificationState>();

// Currently active identifier (for intercepting absolute path requests)
// This tracks which identifier's content is currently being served in the iframe
let activeIdentifier: string | null = null;

/**
 * Set the currently active identifier.
 * Used to intercept absolute path requests from the iframe.
 */
export function setActiveIdentifier(identifier: string | null): void {
  activeIdentifier = identifier;
  if (identifier) {
    logger.debug(TAG, `Active identifier: ${identifier}`);
  }
}

/**
 * Get the currently active identifier.
 */
export function getActiveIdentifier(): string | null {
  return activeIdentifier;
}

/**
 * Broadcast verification event to all clients.
 */
export async function broadcastEvent(event: VerificationEvent): Promise<void> {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'VERIFICATION_EVENT',
      event,
    });
  });
}

/**
 * Start tracking a new manifest verification.
 */
export function startManifestVerification(identifier: string): ManifestVerificationState {
  const state: ManifestVerificationState = {
    identifier,
    manifestTxId: '',
    status: 'resolving',
    manifest: null,
    totalResources: 0,
    verifiedResources: 0,
    failedResources: [],
    pathToTxId: new Map(),
    indexPath: 'index.html',
    startedAt: Date.now(),
  };

  manifestStates.set(identifier, state);

  broadcastEvent({
    type: 'verification-started',
    identifier,
  });

  logger.info(TAG, `Started: ${identifier}`);
  return state;
}

/**
 * Update state after ArNS resolution.
 */
export function setResolvedTxId(identifier: string, manifestTxId: string, gateway?: string): void {
  const state = manifestStates.get(identifier);
  if (state) {
    state.manifestTxId = manifestTxId;
    state.status = 'fetching-manifest';
    if (gateway) {
      state.routingGateway = gateway;
    }
    logger.debug(TAG, `Resolved "${identifier}" → ${manifestTxId.slice(0, 8)}...`);
  }
}

/**
 * Update state after manifest is parsed.
 */
export function setManifestLoaded(
  identifier: string,
  manifest: ArweaveManifest
): void {
  const state = manifestStates.get(identifier);
  if (!state) return;

  state.manifest = manifest;
  state.status = 'verifying';
  state.indexPath = manifest.index?.path || 'index.html';

  // Build path → txId mapping
  state.pathToTxId.clear();
  for (const [path, entry] of Object.entries(manifest.paths)) {
    state.pathToTxId.set(path, entry.id);
  }

  // Include fallback if present
  if (manifest.fallback?.id) {
    state.pathToTxId.set('__fallback__', manifest.fallback.id);
  }

  state.totalResources = state.pathToTxId.size;

  logger.info(TAG, `Manifest: ${state.totalResources} resources`);
  logger.debug(TAG, `Paths:`, Array.from(state.pathToTxId.keys()));

  broadcastEvent({
    type: 'manifest-loaded',
    identifier,
    manifestTxId: state.manifestTxId,
    progress: { current: 0, total: state.totalResources },
  });
}

/**
 * Record successful verification of a resource.
 */
export function recordResourceVerified(identifier: string, _txId: string, path: string): void {
  const state = manifestStates.get(identifier);
  if (!state) return;

  state.verifiedResources++;

  logger.debug(TAG, `✓ ${path} (${state.verifiedResources}/${state.totalResources})`);

  broadcastEvent({
    type: 'verification-progress',
    identifier,
    manifestTxId: state.manifestTxId,
    resourcePath: path,
    progress: { current: state.verifiedResources, total: state.totalResources },
  });

  // Check if all done
  if (state.verifiedResources + state.failedResources.length >= state.totalResources) {
    completeVerification(identifier);
  }
}

/**
 * Record failed verification of a resource.
 */
export function recordResourceFailed(identifier: string, txId: string, path: string, error: string): void {
  const state = manifestStates.get(identifier);
  if (!state) return;

  state.failedResources.push(txId);

  logger.warn(TAG, `✗ ${path}: ${error}`);

  broadcastEvent({
    type: 'verification-failed',
    identifier,
    manifestTxId: state.manifestTxId,
    resourcePath: path,
    error,
    progress: { current: state.verifiedResources, total: state.totalResources },
  });

  // Check if all done (even with failures)
  if (state.verifiedResources + state.failedResources.length >= state.totalResources) {
    completeVerification(identifier);
  }
}

/**
 * Mark verification as complete.
 * Status is 'complete' if all succeeded, 'partial' if some failed but some succeeded.
 * Exported for empty manifest handling.
 */
export function completeVerification(identifier: string): void {
  const state = manifestStates.get(identifier);
  if (!state) return;

  // Determine final status:
  // - 'complete': all resources verified successfully
  // - 'partial': some verified, some failed (can still serve verified resources)
  // - 'failed': all resources failed (nothing to serve)
  if (state.failedResources.length === 0) {
    state.status = 'complete';
  } else if (state.verifiedResources > 0) {
    state.status = 'partial';
  } else {
    state.status = 'failed';
  }

  state.completedAt = Date.now();

  const elapsed = state.completedAt - state.startedAt;
  const statusMsg = state.status === 'complete'
    ? `✅ All ${state.verifiedResources} verified`
    : state.status === 'partial'
      ? `⚠️ ${state.verifiedResources} verified, ${state.failedResources.length} failed`
      : `❌ All ${state.failedResources.length} failed`;

  logger.info(TAG, `Complete: ${statusMsg} (${elapsed}ms)`);

  broadcastEvent({
    type: 'verification-complete',
    identifier,
    manifestTxId: state.manifestTxId,
    progress: { current: state.verifiedResources, total: state.totalResources },
    error: state.failedResources.length > 0
      ? `${state.failedResources.length} resources failed verification`
      : undefined,
  });
}

/**
 * Mark verification as failed with error.
 */
export function failVerification(identifier: string, error: string): void {
  const state = manifestStates.get(identifier);
  if (state) {
    state.status = 'failed';
    state.error = error;
    state.completedAt = Date.now();
  }

  logger.error(TAG, `Failed: ${identifier} - ${error}`);

  broadcastEvent({
    type: 'verification-failed',
    identifier,
    error,
  });
}

/**
 * Get manifest verification state.
 */
export function getManifestState(identifier: string): ManifestVerificationState | null {
  return manifestStates.get(identifier) || null;
}

/**
 * Check if verification is complete for an identifier.
 * Returns true for 'complete' or 'partial' (some resources verified).
 */
export function isVerificationComplete(identifier: string): boolean {
  const state = manifestStates.get(identifier);
  return state?.status === 'complete' || state?.status === 'partial';
}

/**
 * Check if verification is in progress for an identifier.
 */
export function isVerificationInProgress(identifier: string): boolean {
  const state = manifestStates.get(identifier);
  return state?.status === 'resolving' ||
         state?.status === 'fetching-manifest' ||
         state?.status === 'verifying';
}

/**
 * Get the txId for a path within a verified manifest.
 */
export function getTxIdForPath(identifier: string, path: string): string | null {
  const state = manifestStates.get(identifier);
  if (!state?.pathToTxId) return null;

  // Normalize path
  let normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  if (normalizedPath === '' || normalizedPath === '/') {
    // Root path - use index
    normalizedPath = state.indexPath;
  } else if (normalizedPath.endsWith('/')) {
    // Directory path - append index (e.g., "foo/" -> "foo/index.html")
    normalizedPath = normalizedPath + state.indexPath;
  }

  // Direct lookup
  if (state.pathToTxId.has(normalizedPath)) {
    return state.pathToTxId.get(normalizedPath)!;
  }

  // Fallback
  if (state.pathToTxId.has('__fallback__')) {
    return state.pathToTxId.get('__fallback__')!;
  }

  return null;
}

/**
 * Check if a path exists in the active identifier's manifest.
 * Returns the txId if found, null otherwise.
 */
export function getActiveTxIdForPath(path: string): string | null {
  if (!activeIdentifier) return null;
  return getTxIdForPath(activeIdentifier, path);
}

/**
 * Clear state for an identifier.
 */
export function clearManifestState(identifier: string): void {
  manifestStates.delete(identifier);
}

/**
 * Clear all states.
 */
export function clearAllStates(): void {
  manifestStates.clear();
}

/**
 * Clean up old completed/failed manifest states to prevent memory leaks.
 * Keeps states for the specified duration (default 30 minutes).
 */
export function cleanupOldStates(maxAgeMs: number = 30 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [identifier, state] of manifestStates) {
    // Only clean up completed or failed states
    if (state.status === 'complete' || state.status === 'partial' || state.status === 'failed') {
      const age = now - (state.completedAt || state.startedAt);
      if (age > maxAgeMs) {
        manifestStates.delete(identifier);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    logger.debug(TAG, `Cleaned ${cleaned} old states`);
  }

  return cleaned;
}

// Run cleanup periodically (every 10 minutes)
setInterval(() => {
  cleanupOldStates();
}, 10 * 60 * 1000);
