/// <reference lib="webworker" />

import { ManifestResolver } from './manifest-resolver';
import { ContextTracker } from './context-tracker';
import { VerificationTracker } from './verification-tracker';
import { initializeWayfinder, getWayfinder, isWayfinderReady } from './wayfinder-instance';
import type { WayfinderConfig, IframeContext } from './types';

declare const self: ServiceWorkerGlobalScope;

const manifestResolver = new ManifestResolver();
const contextTracker = new ContextTracker();
const verificationTracker = new VerificationTracker();

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
    manifestResolver.clearCache();
    contextTracker.clearAll();
    verificationTracker.clear();
  }
});

// Fetch Interceptor - The heart of verification
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept requests from our iframe proxy
  if (url.pathname.startsWith('/ar-proxy')) {
    event.respondWith(handleArweaveProxy(event.request, event.clientId));
    return;
  }

  // Check if this is a request from an iframe we're tracking
  const context = contextTracker.getContext(event.clientId);
  if (context) {
    event.respondWith(handleNestedResource(event.request, event.clientId, context));
    return;
  }

  // Normal request - pass through
  event.respondWith(fetch(event.request));
});

/**
 * Handle initial /ar-proxy?tx=ABC123 or /ar-proxy?arns=myapp request
 */
async function handleArweaveProxy(request: Request, clientId: string): Promise<Response> {
  if (!isWayfinderReady()) {
    return new Response('Wayfinder not initialized', { status: 503 });
  }

  const url = new URL(request.url);
  const txId = url.searchParams.get('tx');
  const arnsName = url.searchParams.get('arns');

  if (!txId && !arnsName) {
    return new Response('Missing tx or arns parameter', { status: 400 });
  }

  try {
    const wayfinder = getWayfinder();

    // Build ar:// URL
    const arUrl = arnsName ? `ar://${arnsName}` : `ar://${txId}`;

    console.log(`[SW] Fetching ${arUrl}`);

    // Fetch via Wayfinder - VERIFIED STREAM
    const response = await wayfinder.request(arUrl);

    // Check if it's a manifest by looking at content-type
    const contentType = response.headers.get('content-type');

    // Peek at the response to determine if manifest
    // We need to tee the stream to check without consuming it
    const [checkStream, returnStream] = response.body!.tee();

    // Read first chunk to check if manifest
    const reader = checkStream.getReader();
    const firstChunk = await reader.read();
    reader.releaseLock();

    const isManifest = manifestResolver.isManifest(
      contentType,
      firstChunk.value ? new TextDecoder().decode(firstChunk.value) : undefined
    );

    if (isManifest) {
      console.log(`[SW] Detected manifest, parsing...`);

      // Parse the manifest (async, don't await)
      const resolvedTxId = txId || arnsName!; // Use arns name as key if no txId
      parseAndTrackManifest(resolvedTxId, checkStream, clientId);

      // Return the stream to iframe immediately
      return new Response(returnStream, {
        headers: response.headers,
        status: response.status,
      });
    }

    // Not a manifest - just return verified stream
    console.log(`[SW] Not a manifest, returning content directly`);
    return new Response(returnStream, {
      headers: response.headers,
      status: response.status,
    });

  } catch (error) {
    console.error('[SW] Error handling Arweave proxy:', error);
    return new Response(`Failed to load content: ${error}`, { status: 500 });
  }
}

/**
 * Parse manifest and set up context tracking
 */
async function parseAndTrackManifest(
  manifestTxId: string,
  stream: ReadableStream,
  clientId: string
): Promise<void> {
  try {
    const manifest = await manifestResolver.parseManifest(manifestTxId, stream);

    // Set context for this iframe
    contextTracker.setContext(clientId, {
      manifestTxId,
      basePath: '/',
      depth: 0,
    });

    // Start tracking verification progress
    const allTxIds = manifestResolver.getAllTransactionIds(manifest);
    verificationTracker.startManifestVerification(manifestTxId, allTxIds.length);

    console.log(`[SW] Tracking ${allTxIds.length} resources for manifest ${manifestTxId}`);

  } catch (error) {
    console.error(`[SW] Failed to parse manifest ${manifestTxId}:`, error);
  }
}

/**
 * Handle nested resource requests from iframe
 */
async function handleNestedResource(
  request: Request,
  clientId: string,
  context: IframeContext
): Promise<Response> {
  if (!isWayfinderReady()) {
    return new Response('Wayfinder not initialized', { status: 503 });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  console.log(`[SW] Nested resource request: ${path} (context: ${context.manifestTxId})`);

  try {
    // Get the manifest
    const manifest = manifestResolver.getManifest(context.manifestTxId);
    if (!manifest) {
      // Manifest not parsed yet - wait a bit and retry
      await new Promise(resolve => setTimeout(resolve, 100));
      return handleNestedResource(request, clientId, context);
    }

    // Resolve path to transaction ID
    const resolvedTxId = manifestResolver.resolvePath(manifest, path);

    if (!resolvedTxId) {
      console.warn(`[SW] Path not found in manifest: ${path}`);
      return new Response(`Not found: ${path}`, { status: 404 });
    }

    console.log(`[SW] Resolved ${path} → ${resolvedTxId}`);

    // Fetch via Wayfinder - VERIFIED STREAM
    const wayfinder = getWayfinder();
    const response = await wayfinder.request(`ar://${resolvedTxId}`);

    // Check if this resolved to another manifest (nested manifest)
    const contentType = response.headers.get('content-type');
    const [checkStream, returnStream] = response.body!.tee();

    const reader = checkStream.getReader();
    const firstChunk = await reader.read();
    reader.releaseLock();

    const isNestedManifest = manifestResolver.isManifest(
      contentType,
      firstChunk.value ? new TextDecoder().decode(firstChunk.value) : undefined
    );

    if (isNestedManifest) {
      console.log(`[SW] Detected nested manifest at ${path}`);

      // Create nested context
      const nestedContext = contextTracker.createNestedContext(
        clientId,
        resolvedTxId,
        path
      );

      // Parse nested manifest
      parseAndTrackManifest(resolvedTxId, checkStream, clientId);

      // Update context to nested
      contextTracker.setContext(clientId, nestedContext);
    }

    // Record successful verification
    verificationTracker.recordSuccess(context.manifestTxId, resolvedTxId);

    // Return verified stream
    return new Response(returnStream, {
      headers: response.headers,
      status: response.status,
    });

  } catch (error) {
    console.error(`[SW] Error handling nested resource ${path}:`, error);

    // Record failed verification
    verificationTracker.recordFailure(
      context.manifestTxId,
      'unknown',
      String(error)
    );

    return new Response(`Failed to load resource: ${error}`, { status: 500 });
  }
}

console.log('[SW] Service worker script loaded');
