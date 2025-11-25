/// <reference lib="webworker" />

// CRITICAL: Import polyfills FIRST before any other imports
// These must run before any dependency code that might reference Node.js globals
// Order matters! module-polyfill must be first as other polyfills may use exports
import './module-polyfill'; // Provides exports/module for CommonJS dependencies
import './process-polyfill'; // Provides process.env for dependencies that check it
import './buffer-polyfill'; // Provides Buffer for crypto-browserify
import './fetch-polyfill'; // Preserves native fetch before Zone.js patches it

import { initializeWayfinder, getWayfinder, isWayfinderReady } from './wayfinder-instance';
import type { WayfinderConfig, VerificationEvent } from './types';

declare const self: ServiceWorkerGlobalScope;

// Track verification counts per identifier (ArNS name or txId)
const verificationCounts = new Map<string, { total: number; verified: number; failed: number }>();

function getOrCreateCounter(identifier: string) {
  if (!verificationCounts.has(identifier)) {
    verificationCounts.set(identifier, { total: 0, verified: 0, failed: 0 });
  }
  return verificationCounts.get(identifier)!;
}

function logVerificationSummary(identifier: string) {
  const counts = verificationCounts.get(identifier);
  if (counts) {
    console.log(`[SW] 📊 Verification Summary for "${identifier}":`, {
      total: counts.total,
      verified: counts.verified,
      failed: counts.failed,
      status: counts.failed === 0 ? '✅ ALL VERIFIED' : '⚠️ SOME FAILED',
    });
  }
}

/**
 * Broadcast verification event to all clients
 */
async function broadcastVerificationEvent(event: VerificationEvent): Promise<void> {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'VERIFICATION_EVENT',
      event,
    });
  });
}

// Service Worker Installation
self.addEventListener('install', () => {
  console.log('[SW] Installing...');
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (_event) => {
  console.log('[SW] Activating...');
  _event.waitUntil(self.clients.claim()); // Take control immediately
});

// Message Handler - Receive config from main app
self.addEventListener('message', (event) => {
  console.log('[SW] Received message:', event.data);

  if (event.data.type === 'INIT_WAYFINDER') {
    const config: WayfinderConfig = event.data.config;
    initializeWayfinder(config);

    // Send ready confirmation
    event.ports[0]?.postMessage({ type: 'WAYFINDER_READY' });
  }

  if (event.data.type === 'CLEAR_CACHE') {
    // No-op for now - caches handled by Wayfinder internally
    console.log('[SW] Cache clear requested');
  }
});

// Fetch Interceptor - The heart of verification
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Path-based routing: /ar-proxy/{identifier}/{path...}
  // This intercepts ALL requests under /ar-proxy/ including nested resources
  if (url.pathname.startsWith('/ar-proxy/')) {
    event.respondWith(handleArweaveProxyPath(event.request));
    return;
  }

  // Legacy query-based routing (for backwards compatibility)
  if (url.pathname === '/ar-proxy') {
    event.respondWith(handleArweaveProxyQuery(event.request));
    return;
  }

  // Normal request - pass through
  event.respondWith(fetch(event.request));
});

/**
 * Handle path-based proxy: /ar-proxy/{identifier}/{path...}
 * This is the main handler that intercepts ALL requests under /ar-proxy/
 * including nested resources like /ar-proxy/vilenarios/script.js
 */
async function handleArweaveProxyPath(request: Request): Promise<Response> {
  if (!isWayfinderReady()) {
    console.warn('[SW] ⚠️ Wayfinder not ready for request:', request.url);
    return new Response('Wayfinder not initialized', { status: 503 });
  }

  const url = new URL(request.url);
  // Remove /ar-proxy/ prefix to get: {identifier}/{path...}
  const fullPath = url.pathname.slice('/ar-proxy/'.length);

  // Split into identifier and resource path
  // Examples:
  //   "vilenarios/" -> identifier="vilenarios", resourcePath=""
  //   "vilenarios/script.js" -> identifier="vilenarios", resourcePath="script.js"
  //   "ABC123...XYZ/" -> identifier="ABC123...XYZ", resourcePath=""
  const firstSlash = fullPath.indexOf('/');
  const identifier = firstSlash > 0 ? fullPath.slice(0, firstSlash) : fullPath;
  const resourcePath = firstSlash > 0 ? fullPath.slice(firstSlash + 1) : '';

  if (!identifier) {
    console.error('[SW] ❌ Missing identifier in path:', url.pathname);
    return new Response('Missing identifier in path', { status: 400 });
  }

  // Build ar:// URL
  // For the root request (empty resourcePath), just use ar://{identifier}
  // For nested resources, use ar://{identifier}/{resourcePath}
  const arUrl = resourcePath ? `ar://${identifier}/${resourcePath}` : `ar://${identifier}`;

  const isRootRequest = !resourcePath;
  const requestType = isRootRequest ? '📄 ROOT' : '📦 ASSET';

  console.log(`[SW] ${requestType} Request:`, {
    originalPath: url.pathname,
    identifier,
    resourcePath: resourcePath || '(none)',
    arUrl,
  });

  // Get or create counter for this identifier
  const counter = getOrCreateCounter(identifier);

  // Broadcast "started" event for root requests only
  if (isRootRequest) {
    // Reset counter for new root request
    counter.total = 0;
    counter.verified = 0;
    counter.failed = 0;

    broadcastVerificationEvent({
      type: 'verification-started',
      txId: identifier,
      progress: { current: 0, total: 1 },
    });
  }

  // Increment total count for this request
  counter.total++;

  try {
    const wayfinder = getWayfinder();

    console.log(`[SW] 🔄 Fetching via Wayfinder: ${arUrl}`);
    const startTime = performance.now();

    // Fetch via Wayfinder - VERIFIED STREAM
    const response = await wayfinder.request(arUrl);

    const elapsed = (performance.now() - startTime).toFixed(0);
    const contentType = response.headers.get('content-type') || 'unknown';
    const contentLength = response.headers.get('content-length') || 'unknown';

    // Mark as verified
    counter.verified++;

    console.log(`[SW] ✅ Fetched ${arUrl}:`, {
      status: response.status,
      contentType,
      contentLength,
      elapsed: `${elapsed}ms`,
      verification: `${counter.verified}/${counter.total} verified`,
    });

    // Log all response headers for debugging
    console.log(`[SW] 📋 Response headers for ${resourcePath || 'root'}:`);
    response.headers.forEach((value, key) => {
      console.log(`[SW]   ${key}: ${value}`);
    });

    // Broadcast progress
    broadcastVerificationEvent({
      type: 'verification-progress',
      txId: identifier,
      resourcePath: resourcePath || undefined,
      progress: { current: counter.verified, total: counter.total },
    });

    // Log summary periodically
    if (counter.verified % 5 === 0 || isRootRequest) {
      logVerificationSummary(identifier);
    }

    // Return the verified response
    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
    });

  } catch (error) {
    console.error(`[SW] ❌ Error fetching ${arUrl}:`, error);

    // Mark as failed
    counter.failed++;

    // Broadcast failure event
    broadcastVerificationEvent({
      type: 'verification-failed',
      txId: identifier,
      resourcePath: resourcePath || undefined,
      error: error instanceof Error ? error.message : String(error),
    });

    logVerificationSummary(identifier);

    return new Response(`Failed to load: ${error}`, { status: 500 });
  }
}

/**
 * Handle legacy query-based proxy: /ar-proxy?tx=ABC123 or /ar-proxy?arns=myapp
 * Simplified version - just fetches and returns content directly
 */
async function handleArweaveProxyQuery(request: Request): Promise<Response> {
  if (!isWayfinderReady()) {
    return new Response('Wayfinder not initialized', { status: 503 });
  }

  const url = new URL(request.url);
  const txId = url.searchParams.get('tx');
  const arnsName = url.searchParams.get('arns');

  if (!txId && !arnsName) {
    return new Response('Missing tx or arns parameter', { status: 400 });
  }

  const contentId = txId || arnsName!;
  const arUrl = arnsName ? `ar://${arnsName}` : `ar://${txId}`;

  console.log(`[SW] Legacy query request: ${arUrl}`);

  broadcastVerificationEvent({
    type: 'verification-started',
    txId: contentId,
    progress: { current: 0, total: 1 },
  });

  try {
    const wayfinder = getWayfinder();
    const response = await wayfinder.request(arUrl);

    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
    });

  } catch (error) {
    console.error('[SW] Error handling Arweave proxy:', error);

    broadcastVerificationEvent({
      type: 'verification-failed',
      txId: contentId,
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(`Failed to load content: ${error}`, { status: 500 });
  }
}

console.log('[SW] Service worker script loaded');
