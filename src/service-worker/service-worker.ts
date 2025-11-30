/// <reference lib="webworker" />

/**
 * Service Worker with manifest-first verification.
 *
 * Flow:
 * 1. Intercept /ar-proxy/{identifier}/ requests
 * 2. Resolve ArNS name to manifest txId (or use txId directly)
 * 3. Fetch and parse manifest
 * 4. Pre-verify ALL resources in manifest
 * 5. Cache verified content
 * 6. Serve from verified cache
 */

// CRITICAL: Import polyfills FIRST before any other imports
// These must run before any dependency code that might reference Node.js globals
import './module-polyfill';
import './process-polyfill';
import './buffer-polyfill';
import './fetch-polyfill';

import { initializeWayfinder, isWayfinderReady, getConfig } from './wayfinder-instance';
import { verifyIdentifier, getVerifiedContent, setVerificationConcurrency } from './manifest-verifier';
import {
  getManifestState,
  isVerificationComplete,
  isVerificationInProgress,
  broadcastEvent,
  clearManifestState,
} from './verification-state';
import { verifiedCache } from './verified-cache';
import type { WayfinderConfig } from './types';

declare const self: ServiceWorkerGlobalScope;

// Track pending verification promises to avoid duplicate work
const pendingVerifications = new Map<string, Promise<void>>();

// ============================================================================
// Service Worker Lifecycle
// ============================================================================

self.addEventListener('install', () => {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(self.clients.claim());
});

// ============================================================================
// Message Handler
// ============================================================================

self.addEventListener('message', (event) => {
  console.log('[SW] Received message:', event.data?.type);

  if (event.data.type === 'INIT_WAYFINDER') {
    const config: WayfinderConfig = event.data.config;
    console.log('[SW] Initializing with trustedGateways:', config.trustedGateways);
    initializeWayfinder(config);
    // Apply concurrency setting if provided
    if (config.concurrency) {
      setVerificationConcurrency(config.concurrency);
    }
    event.ports[0]?.postMessage({ type: 'WAYFINDER_READY' });
  }

  if (event.data.type === 'CLEAR_CACHE') {
    verifiedCache.clear();
    console.log('[SW] Cache cleared');
    event.ports[0]?.postMessage({ type: 'CACHE_CLEARED' });
  }

  if (event.data.type === 'CLEAR_VERIFICATION') {
    const identifier = event.data.identifier;
    if (identifier) {
      // Get the manifest state to find all txIds to clear from cache
      const state = getManifestState(identifier);
      if (state?.pathToTxId) {
        const txIds = Array.from(state.pathToTxId.values());
        // Also include the manifest txId itself
        if (state.manifestTxId) {
          txIds.push(state.manifestTxId);
        }
        verifiedCache.clearForManifest(txIds);
      }
      // Clear the manifest state
      clearManifestState(identifier);
      console.log(`[SW] Cleared verification state for: ${identifier}`);
    }
    event.ports[0]?.postMessage({ type: 'VERIFICATION_CLEARED' });
  }
});

// ============================================================================
// Fetch Handler
// ============================================================================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Log all fetch requests to help debug
  console.log(`[SW] Fetch intercepted: ${url.pathname}`);

  // Only intercept /ar-proxy/ requests
  if (url.pathname.startsWith('/ar-proxy/')) {
    console.log(`[SW] Handling ar-proxy request: ${url.pathname}`);
    event.respondWith(handleArweaveProxy(event.request));
    return;
  }

  // Pass through all other requests
  return;
});

// ============================================================================
// Main Proxy Handler
// ============================================================================

async function handleArweaveProxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { identifier, resourcePath } = parseProxyPath(url.pathname);

  if (!identifier) {
    return new Response('Missing identifier in path', { status: 400 });
  }

  console.log(`[SW] Request: ${identifier}/${resourcePath || '(index)'}`);

  // Check if Wayfinder is ready
  if (!isWayfinderReady()) {
    console.warn('[SW] Wayfinder not initialized');
    return new Response('Verification service not ready. Please reload.', { status: 503 });
  }

  const config = getConfig();
  if (!config) {
    return new Response('Configuration not available', { status: 503 });
  }

  try {
    // Check if verification is already complete for this identifier
    const complete = isVerificationComplete(identifier);
    const inProgress = isVerificationInProgress(identifier);
    const state = getManifestState(identifier);
    console.log(`[SW] Verification status for ${identifier}: complete=${complete}, inProgress=${inProgress}, status=${state?.status}, verified=${state?.verifiedResources}/${state?.totalResources}`);

    if (complete) {
      console.log(`[SW] Serving from cache: ${identifier}/${resourcePath}`);
      return serveFromCache(identifier, resourcePath);
    }

    // Check if verification is in progress
    if (inProgress) {
      // Wait for it to complete
      console.log(`[SW] Waiting for verification: ${identifier}`);
      await waitForVerification(identifier);
      return serveFromCache(identifier, resourcePath);
    }

    // Start new verification
    console.log(`[SW] Starting new verification: ${identifier}`);
    await startVerification(identifier, config);
    return serveFromCache(identifier, resourcePath);

  } catch (error) {
    console.error(`[SW] Error handling request:`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    broadcastEvent({
      type: 'verification-failed',
      identifier,
      error: errorMsg,
    });

    return new Response(`Verification failed: ${errorMsg}`, { status: 500 });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse /ar-proxy/{identifier}/{path...} into components.
 */
function parseProxyPath(pathname: string): { identifier: string; resourcePath: string } {
  // Remove /ar-proxy/ prefix
  const fullPath = pathname.slice('/ar-proxy/'.length);

  // Split into identifier and resource path
  const firstSlash = fullPath.indexOf('/');

  if (firstSlash === -1) {
    // Just identifier, no trailing slash
    return { identifier: fullPath, resourcePath: '' };
  }

  const identifier = fullPath.slice(0, firstSlash);
  const resourcePath = fullPath.slice(firstSlash + 1);

  return { identifier, resourcePath };
}

/**
 * Start verification for an identifier.
 * Deduplicates concurrent requests for the same identifier.
 */
async function startVerification(identifier: string, config: WayfinderConfig): Promise<void> {
  // Check if already pending
  let pending = pendingVerifications.get(identifier);
  if (pending) {
    console.log(`[SW] Waiting for existing verification: ${identifier}`);
    return pending;
  }

  // Start new verification
  console.log(`[SW] Starting verification: ${identifier}`);
  pending = verifyIdentifier(identifier, config)
    .finally(() => {
      pendingVerifications.delete(identifier);
    });

  pendingVerifications.set(identifier, pending);
  return pending;
}

/**
 * Wait for an in-progress verification to complete.
 */
async function waitForVerification(identifier: string): Promise<void> {
  const pending = pendingVerifications.get(identifier);
  if (pending) {
    await pending;
    return;
  }

  // Poll for completion (shouldn't normally happen)
  const maxWait = 60000; // 60 seconds
  const pollInterval = 100;
  let waited = 0;

  while (waited < maxWait) {
    if (isVerificationComplete(identifier)) {
      return;
    }
    if (!isVerificationInProgress(identifier)) {
      throw new Error('Verification stopped unexpectedly');
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    waited += pollInterval;
  }

  throw new Error('Verification timeout');
}

/**
 * Serve a resource from the verified cache.
 * Works for 'complete' and 'partial' status.
 */
function serveFromCache(identifier: string, resourcePath: string): Response {
  const state = getManifestState(identifier);

  if (!state) {
    console.error(`[SW] No state for identifier: ${identifier}`);
    return new Response('Not found', { status: 404 });
  }

  if (state.status === 'failed') {
    return new Response(`Verification failed: ${state.error}`, { status: 500 });
  }

  if (state.status !== 'complete' && state.status !== 'partial') {
    return new Response('Verification not complete', { status: 503 });
  }

  // Get verified content
  const response = getVerifiedContent(identifier, resourcePath);

  if (!response) {
    console.warn(`[SW] Resource not found: ${identifier}/${resourcePath}`);

    // Try to provide helpful error
    const state = getManifestState(identifier);
    const availablePaths = state?.pathToTxId ? Array.from(state.pathToTxId.keys()).slice(0, 10) : [];

    return new Response(
      `Resource not found: ${resourcePath}\n\nAvailable paths: ${availablePaths.join(', ')}${availablePaths.length >= 10 ? '...' : ''}`,
      { status: 404 }
    );
  }

  return response;
}

// ============================================================================
// Startup
// ============================================================================

console.log('[SW] Service worker loaded (manifest-first verification)');
