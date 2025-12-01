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
  setActiveIdentifier,
  getActiveIdentifier,
  getActiveTxIdForPath,
} from './verification-state';
import { verifiedCache } from './verified-cache';
import { logger } from './logger';
import { injectLocationPatch } from './location-patcher';
import type { SwWayfinderConfig } from './types';

const TAG = 'SW';

declare const self: ServiceWorkerGlobalScope;

// Track pending verification promises to avoid duplicate work
const pendingVerifications = new Map<string, Promise<void>>();

// ============================================================================
// Service Worker Lifecycle
// ============================================================================

self.addEventListener('install', () => {
  logger.debug(TAG, 'Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  logger.debug(TAG, 'Activating...');
  event.waitUntil(self.clients.claim());
});

// ============================================================================
// Message Handler
// ============================================================================

self.addEventListener('message', (event) => {
  logger.debug(TAG, `Received message: ${event.data?.type}`);

  if (event.data.type === 'INIT_WAYFINDER') {
    const config: SwWayfinderConfig = event.data.config;
    initializeWayfinder(config);
    if (config.concurrency) {
      setVerificationConcurrency(config.concurrency);
    }
    event.ports[0]?.postMessage({ type: 'WAYFINDER_READY' });
  }

  if (event.data.type === 'CLEAR_CACHE') {
    verifiedCache.clear();
    logger.info(TAG, 'Cache cleared');
    event.ports[0]?.postMessage({ type: 'CACHE_CLEARED' });
  }

  if (event.data.type === 'CLEAR_VERIFICATION') {
    const identifier = event.data.identifier;
    if (identifier) {
      const state = getManifestState(identifier);
      if (state?.pathToTxId) {
        const txIds = Array.from(state.pathToTxId.values());
        if (state.manifestTxId) {
          txIds.push(state.manifestTxId);
        }
        verifiedCache.clearForManifest(txIds);
      }
      clearManifestState(identifier);
      // Clear active identifier if it matches
      if (getActiveIdentifier() === identifier) {
        setActiveIdentifier(null);
      }
      logger.info(TAG, `Cleared verification for: ${identifier}`);
    }
    event.ports[0]?.postMessage({ type: 'VERIFICATION_CLEARED' });
  }
});

// ============================================================================
// Fetch Handler
// ============================================================================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Primary: Intercept /ar-proxy/ requests
  if (url.pathname.startsWith('/ar-proxy/')) {
    logger.debug(TAG, `Proxy request: ${url.pathname}`);
    event.respondWith(handleArweaveProxy(event.request));
    return;
  }

  // Secondary: Intercept absolute path requests that match the active identifier's manifest
  // This handles apps that use absolute paths like "/assets/foo.js" instead of relative paths
  //
  // IMPORTANT: Never intercept navigation requests (mode: 'navigate') as these are for
  // loading the main Wayfinder app itself, not for loading Arweave content resources.
  // The ar-proxy iframe's initial load is already handled by the /ar-proxy/ check above.
  if (event.request.mode === 'navigate') {
    return;
  }

  const activeId = getActiveIdentifier();
  if (activeId && isVerificationComplete(activeId)) {
    // Check if this path exists in the active manifest
    const path = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    const txId = getActiveTxIdForPath(path);

    if (txId) {
      logger.debug(TAG, `Absolute path intercept: ${url.pathname} → ${activeId}`);
      event.respondWith(serveFromCache(activeId, path));
      return;
    }
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

  // Check if Wayfinder is ready
  if (!isWayfinderReady()) {
    logger.warn(TAG, 'Wayfinder not initialized');
    return new Response('Verification service not ready. Please reload.', { status: 503 });
  }

  const config = getConfig();
  if (!config) {
    return new Response('Configuration not available', { status: 503 });
  }

  try {
    const complete = isVerificationComplete(identifier);
    const inProgress = isVerificationInProgress(identifier);

    if (complete) {
      logger.debug(TAG, `Serving cached: ${identifier}/${resourcePath || 'index'}`);
      // Set as active so we can intercept absolute path requests from this app
      setActiveIdentifier(identifier);
      return serveFromCache(identifier, resourcePath);
    }

    if (inProgress) {
      logger.debug(TAG, `Waiting for verification: ${identifier}`);
      await waitForVerification(identifier);
      // Set as active so we can intercept absolute path requests from this app
      setActiveIdentifier(identifier);
      return serveFromCache(identifier, resourcePath);
    }

    // Start new verification
    logger.info(TAG, `Starting verification: ${identifier}`);
    await startVerification(identifier, config);
    // Set as active so we can intercept absolute path requests from this app
    setActiveIdentifier(identifier);
    return serveFromCache(identifier, resourcePath);

  } catch (error) {
    logger.error(TAG, 'Verification error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    broadcastEvent({
      type: 'verification-failed',
      identifier,
      error: errorMsg,
    });

    return createErrorResponse('Verification Failed', errorMsg, identifier);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a styled HTML error response.
 */
function createErrorResponse(title: string, message: string, identifier: string): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0e0e0f;
      color: #cacad6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      max-width: 480px;
      text-align: center;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #f23f5d;
      margin-bottom: 16px;
    }
    .message {
      font-size: 14px;
      color: #7f7f87;
      margin-bottom: 24px;
      word-break: break-word;
    }
    .identifier {
      font-family: monospace;
      font-size: 12px;
      background: #1c1c1f;
      padding: 8px 12px;
      border-radius: 6px;
      color: #a3a3ad;
      margin-bottom: 24px;
      word-break: break-all;
    }
    .hint {
      font-size: 12px;
      color: #7f7f87;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🛡️</div>
    <h1>${title}</h1>
    <div class="message">${message || 'An unknown error occurred during verification.'}</div>
    <div class="identifier">${identifier}</div>
    <div class="hint">Try using a different verification method or retry with a different gateway.</div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

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
async function startVerification(identifier: string, config: SwWayfinderConfig): Promise<void> {
  // Check if already pending
  let pending = pendingVerifications.get(identifier);
  if (pending) {
    logger.debug(TAG, `Joining existing verification: ${identifier}`);
    return pending;
  }

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
 * For HTML content, injects a location patch script to make the app
 * think it's running at the gateway subdomain.
 */
function serveFromCache(identifier: string, resourcePath: string): Response {
  const state = getManifestState(identifier);

  if (!state) {
    logger.error(TAG, `No state for: ${identifier}`);
    return createErrorResponse('Not Found', 'No verification state found for this content.', identifier);
  }

  if (state.status === 'failed') {
    return createErrorResponse('Verification Failed', state.error || 'All resources failed verification.', identifier);
  }

  if (state.status !== 'complete' && state.status !== 'partial') {
    return createErrorResponse('Verification In Progress', 'Please wait while content is being verified.', identifier);
  }

  // Pass the location patcher to inject into HTML responses
  const response = getVerifiedContent(identifier, resourcePath, injectLocationPatch);

  if (!response) {
    logger.warn(TAG, `Resource not found: ${identifier}/${resourcePath}`);
    const availablePaths = state?.pathToTxId ? Array.from(state.pathToTxId.keys()).slice(0, 10) : [];
    const pathsHint = availablePaths.length > 0
      ? `Available paths: ${availablePaths.join(', ')}${availablePaths.length >= 10 ? '...' : ''}`
      : 'No paths available in manifest.';
    return createErrorResponse('Resource Not Found', `The path "${resourcePath}" was not found in the manifest. ${pathsHint}`, identifier);
  }

  return response;
}

// ============================================================================
// Startup
// ============================================================================

logger.info(TAG, 'Service worker loaded');
