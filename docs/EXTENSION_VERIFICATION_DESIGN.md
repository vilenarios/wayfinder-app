# Wayfinder Chrome Extension: Content Verification Design Document

This document provides a comprehensive design for implementing service worker-based content verification in the Wayfinder Chrome Extension, mirroring the functionality in the wayfinder-app.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Target Architecture](#target-architecture)
4. [Security Model](#security-model)
5. [Implementation Components](#implementation-components)
6. [Message Passing Architecture](#message-passing-architecture)
7. [UI Components](#ui-components)
8. [Implementation Plan](#implementation-plan)
9. [Chrome Extension Considerations](#chrome-extension-considerations)
10. [Code Migration Strategy](#code-migration-strategy)

---

## Executive Summary

### Goal
Extend the Wayfinder Chrome Extension with a dedicated verification page that uses service workers to fetch, verify, cache, and serve Arweave content. This creates a secure browsing experience where all content is cryptographically verified before display.

### Key Differences from Current Extension
| Current Extension | Target Implementation |
|-------------------|----------------------|
| Redirects ar:// URLs to gateway URLs directly | Offers optional "verified mode" that routes through local verification |
| Uses `RemoteVerificationStrategy` (checks gateway headers) | Uses `HashVerificationStrategy` or `SignatureVerificationStrategy` (local cryptographic verification) |
| Shows toast notifications for verification status | Shows full loading screen with progress, plus verification badge |
| No content caching | LRU cache for verified content (100MB limit) |
| No manifest awareness | Full manifest parsing and resource pre-verification |

---

## Current State Analysis

### wayfinder-app Service Worker Architecture

The wayfinder-app implements verification through these key components:

#### 1. Service Worker Entry Point (`service-worker.ts`)
- **Fetch Interception**: Intercepts `/ar-proxy/{identifier}/` requests
- **Absolute Path Handling**: Intercepts absolute paths (e.g., `/assets/foo.js`) for manifest-based apps
- **Message Handling**: Receives configuration via `INIT_WAYFINDER`, `CLEAR_CACHE`, `CLEAR_VERIFICATION` messages
- **Lifecycle**: Uses `skipWaiting()` and `clients.claim()` for immediate activation

```typescript
// Key interception pattern
self.addEventListener('fetch', (event) => {
  if (url.pathname.startsWith('/ar-proxy/')) {
    event.respondWith(handleArweaveProxy(event.request));
  }
  // Also intercepts absolute paths for active identifier's manifest
});
```

#### 2. Manifest Verifier (`manifest-verifier.ts`)
- **ArNS Resolution**: Resolves ArNS names via trusted gateways with consensus checking
- **Manifest Verification**: Verifies manifest content BEFORE trusting path→txId mappings
- **Resource Verification**: Parallel verification of all manifest resources with concurrency control
- **Fallback Gateways**: Retries with fallback gateways if primary fails

#### 3. Verification State (`verification-state.ts`)
- **State Machine**: `resolving` → `fetching-manifest` → `verifying` → `complete`/`partial`/`failed`
- **Progress Tracking**: Tracks `totalResources`, `verifiedResources`, `failedResources`
- **Event Broadcasting**: Broadcasts events to all clients for UI updates
- **Active Identifier**: Tracks currently active content for absolute path interception

#### 4. Verified Cache (`verified-cache.ts`)
- **LRU Cache**: 100MB limit with LRU eviction
- **Content Storage**: Stores `txId`, `contentType`, `data`, `headers`, `verifiedAt`
- **Response Factory**: Creates `Response` objects with verification headers

### Chrome Extension Current Architecture

The extension currently:
1. **Background Script** (`background.ts`): Intercepts `ar://` navigation, resolves URLs via Wayfinder, redirects tabs
2. **Content Script** (`content.ts`): Converts `ar://` links on pages, shows verification toasts
3. **Routing** (`routing.ts`): Manages Wayfinder instance, handles ENS/ArNS resolution
4. **Uses `RemoteVerificationStrategy`**: Checks `x-ar-io-verified` header from gateway (not local verification)

---

## Target Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Chrome Extension                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐    ┌────────────────────────────────────┐ │
│  │  Background SW   │    │        Verification Page           │ │
│  │  (background.ts) │    │     (verification.html)            │ │
│  │                  │    │                                    │ │
│  │  - ar:// routing │    │  ┌────────────────────────────┐   │ │
│  │  - Gateway sync  │◄───┼──┤ Verification Service Worker │   │ │
│  │  - Perf tracking │    │  │                              │   │ │
│  │                  │    │  │ - /ar-proxy/ interception   │   │ │
│  └────────┬─────────┘    │  │ - Manifest verification     │   │ │
│           │              │  │ - Resource caching          │   │ │
│           │              │  │ - Content serving           │   │ │
│           ▼              │  └────────────────────────────┘   │ │
│  ┌──────────────────┐    │                                    │ │
│  │  User chooses:   │    │  ┌────────────────────────────┐   │ │
│  │  1. Direct route │    │  │   Verification UI           │   │ │
│  │  2. Verified mode│────┼──►                              │   │ │
│  └──────────────────┘    │  │ - Loading screen            │   │ │
│                          │  │ - Progress indicators       │   │ │
│                          │  │ - Verification badge        │   │ │
│                          │  │ - Content iframe            │   │ │
│                          │  └────────────────────────────┘   │ │
│                          └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Verification Page** (`verification.html`/`verification.ts`)
   - Dedicated extension page for verified content viewing
   - Contains iframe for verified content display
   - Registers and manages its own service worker
   - Shows verification loading screen and badge

2. **Verification Service Worker** (`verification-sw.ts`)
   - Separate from background.js (different scope)
   - Handles `/ar-proxy/` requests
   - Implements full manifest verification
   - Manages verified content cache

3. **Shared Utilities**
   - Verification state management
   - Cache implementation
   - Gateway health tracking
   - Trusted gateway fetching

---

## Security Model

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Malicious gateway serves forged content | Hash verification against trusted gateways |
| ArNS name hijacking | Consensus checking across multiple trusted gateways |
| Manifest poisoning (bad path→txId mappings) | Verify manifest content hash BEFORE trusting mappings |
| Man-in-the-middle | HTTPS + cryptographic verification |
| Cache poisoning | Only cache after verification passes |

### Verification Flow (from wayfinder-app)

```
1. User navigates to ar://identifier
   │
2. Extension redirects to verification page with ?q=identifier
   │
3. Page loads iframe pointing to /ar-proxy/identifier/
   │
4. Service Worker intercepts request
   │
5. IF txId (43 chars): Skip resolution
   ELSE: Resolve ArNS via trusted gateways (consensus)
   │
6. Select responsive routing gateway (HEAD request check)
   │
7. Fetch raw content from /raw/{txId}
   │
8. Compute SHA-256 hash locally
   │
9. Verify hash against trusted gateway (x-ar-io-digest header)
   │
10. IF manifest:
    a. Parse manifest (only after hash verification!)
    b. Build path→txId mapping
    c. Verify ALL resources in parallel (with concurrency limit)
    │
11. Cache verified content
    │
12. Serve from cache, injecting location patch for HTML
    │
13. For absolute path requests from iframe:
    Check if path exists in active manifest → serve from cache
```

### Dual Gateway Pools

```typescript
// From wayfinder-app/src/utils/trustedGateways.ts

// TRUSTED GATEWAYS - for hash verification (high stake = high trust)
getTrustedGateways(count): Promise<GatewayWithStake[]>
// - Fetches from @ar.io/sdk
// - Sorts by total stake (operator + delegated)
// - Returns top N by stake
// - Cached 24 hours in localStorage

// ROUTING GATEWAYS - for content fetching (broader pool)
getRoutingGateways(): Promise<URL[]>
// - Fetches from arweave.net/ar-io/peers
// - Randomly shuffles for load distribution
// - Returns up to 20 gateways
```

---

## Implementation Components

### 1. Verification Service Worker

**File: `src/verification/verification-sw.ts`**

```typescript
// Core structure (adapted from wayfinder-app)

/// <reference lib="webworker" />

// Polyfills (if needed for wayfinder-core in SW context)
import './polyfills';

import { HashVerificationStrategy } from '@ar.io/wayfinder-core';
import { verifiedCache } from './verified-cache';
import { verificationState } from './verification-state';

declare const self: ServiceWorkerGlobalScope;

// Lifecycle
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Message handling
self.addEventListener('message', (event) => {
  switch (event.data.type) {
    case 'INIT_WAYFINDER':
      initializeWayfinder(event.data.config);
      event.ports[0]?.postMessage({ type: 'WAYFINDER_READY' });
      break;
    case 'CLEAR_CACHE':
      verifiedCache.clear();
      event.ports[0]?.postMessage({ type: 'CACHE_CLEARED' });
      break;
    case 'CLEAR_VERIFICATION':
      clearVerificationState(event.data.identifier);
      event.ports[0]?.postMessage({ type: 'VERIFICATION_CLEARED' });
      break;
  }
});

// Fetch interception
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/ar-proxy/')) {
    event.respondWith(handleArweaveProxy(event.request));
    return;
  }

  // Intercept absolute paths for active manifest
  if (event.request.mode !== 'navigate') {
    const activeId = getActiveIdentifier();
    if (activeId && isVerificationComplete(activeId)) {
      const txId = getActiveTxIdForPath(url.pathname);
      if (txId) {
        event.respondWith(serveFromCache(activeId, url.pathname));
        return;
      }
    }
  }
});

async function handleArweaveProxy(request: Request): Promise<Response> {
  // 1. Parse identifier from /ar-proxy/{identifier}/{path}
  // 2. Wait for Wayfinder initialization
  // 3. Check verification state (complete/in-progress/new)
  // 4. Start or join verification
  // 5. Serve from cache
}
```

### 2. Manifest Verifier

**File: `src/verification/manifest-verifier.ts`**

Key functions to port from wayfinder-app:

```typescript
// ArNS resolution with consensus
async function resolveArnsToTxId(
  arnsName: string,
  trustedGateways: string[]
): Promise<{ txId: string; gateway: string }>

// Gateway selection with health checking
async function selectWorkingGateway(
  txId: string,
  gateways: string[]
): Promise<string>

// Fetch and verify raw content
async function fetchAndVerifyRawContent(
  txId: string,
  routingGateway: string
): Promise<ManifestCheckResult>

// Verify all manifest resources
async function verifyAllResources(
  identifier: string,
  verificationId: number,
  manifest: ArweaveManifest,
  primaryGateway: string,
  fallbackGateways: string[]
): Promise<boolean>

// Main entry point
export async function verifyIdentifier(
  identifier: string,
  config: SwWayfinderConfig
): Promise<void>
```

### 3. Verified Cache

**File: `src/verification/verified-cache.ts`**

```typescript
// Port from wayfinder-app/src/service-worker/verified-cache.ts

const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB

interface VerifiedResource {
  txId: string;
  contentType: string;
  data: ArrayBuffer;
  headers: Record<string, string>;
  verifiedAt: number;
  lastAccessedAt: number;
}

class VerifiedCacheImpl {
  private cache = new Map<string, VerifiedResource>();
  private currentSize = 0;

  set(txId: string, resource: Omit<VerifiedResource, 'txId' | 'verifiedAt' | 'lastAccessedAt'>): void
  get(txId: string): VerifiedResource | null
  has(txId: string): boolean
  toResponse(resource: VerifiedResource): Response
  clear(): void
  clearForManifest(txIds: string[]): void

  private evictLRU(): void
}

export const verifiedCache = new VerifiedCacheImpl();
```

### 4. Verification State

**File: `src/verification/verification-state.ts`**

```typescript
// Port from wayfinder-app/src/service-worker/verification-state.ts

interface ManifestVerificationState {
  identifier: string;
  verificationId: number;
  manifestTxId: string;
  status: 'resolving' | 'fetching-manifest' | 'verifying' | 'complete' | 'partial' | 'failed';
  manifest: ArweaveManifest | null;
  totalResources: number;
  verifiedResources: number;
  failedResources: string[];
  pathToTxId: Map<string, string>;
  indexPath: string;
  isSingleFile: boolean;
  routingGateway?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

// State management functions
export function startManifestVerification(identifier: string): number
export function setResolvedTxId(identifier: string, verificationId: number, txId: string): void
export function setManifestLoaded(identifier: string, verificationId: number, manifest: ArweaveManifest, isSingleFile?: boolean): void
export function recordResourceVerified(identifier: string, verificationId: number, txId: string, path: string): void
export function recordResourceFailed(identifier: string, verificationId: number, txId: string, path: string, error: string): void
export function completeVerification(identifier: string, verificationId: number): void
export function failVerification(identifier: string, verificationId: number, error: string): void

// Query functions
export function getManifestState(identifier: string): ManifestVerificationState | null
export function isVerificationComplete(identifier: string): boolean
export function isVerificationInProgress(identifier: string): boolean
export function getActiveTxIdForPath(path: string): string | null

// Active identifier tracking
export function setActiveIdentifier(identifier: string | null): void
export function getActiveIdentifier(): string | null

// Event broadcasting
export function broadcastEvent(event: VerificationEvent): Promise<void>
```

### 5. Location Patcher

**File: `src/verification/location-patcher.ts`**

```typescript
// Port from wayfinder-app/src/service-worker/location-patcher.ts

/**
 * Injects a script into HTML that uses history.replaceState() to
 * rewrite location.pathname from /ar-proxy/{identifier}/ to /
 *
 * This makes apps think they're running at the root path,
 * which is necessary for proper routing in SPAs.
 */
export function injectLocationPatch(
  html: string,
  identifier: string,
  gatewayUrl: string
): string
```

### 6. Gateway Health

**File: `src/verification/gateway-health.ts`**

```typescript
// Port from wayfinder-app/src/service-worker/gateway-health.ts

class SwGatewayHealthCache {
  private unhealthyGateways: Map<string, GatewayHealthEntry> = new Map();

  markUnhealthy(gateway: string, durationMs?: number, error?: string): void
  isHealthy(gateway: string): boolean
  filterHealthy(gateways: string[]): string[]
  clear(): void
}

export const swGatewayHealth = new SwGatewayHealthCache();
```

---

## Message Passing Architecture

### Extension ↔ Verification Page Communication

```typescript
// verification-messaging.ts

// Messages from page to service worker
type ToSwMessage =
  | { type: 'INIT_WAYFINDER'; config: SwWayfinderConfig }
  | { type: 'CLEAR_CACHE' }
  | { type: 'CLEAR_VERIFICATION'; identifier: string };

// Messages from service worker to page (broadcast)
type FromSwMessage =
  | { type: 'VERIFICATION_EVENT'; event: VerificationEvent };

// Verification events
type VerificationEvent =
  | { type: 'verification-started'; identifier: string }
  | { type: 'routing-gateway'; identifier: string; gatewayUrl: string }
  | { type: 'manifest-loaded'; identifier: string; progress: { current: number; total: number }; isSingleFile?: boolean }
  | { type: 'verification-progress'; identifier: string; resourcePath: string; progress: { current: number; total: number } }
  | { type: 'verification-complete'; identifier: string; progress: { current: number; total: number } }
  | { type: 'verification-failed'; identifier: string; error: string };
```

### Background Script ↔ Verification Page

```typescript
// When user chooses verified mode
chrome.tabs.create({
  url: chrome.runtime.getURL('verification.html') + `?q=${encodeURIComponent(arUrl)}`
});

// Or within same tab
chrome.tabs.update(tabId, {
  url: chrome.runtime.getURL('verification.html') + `?q=${encodeURIComponent(arUrl)}`
});
```

---

## UI Components

### 1. Verification Page (`verification.html`)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Wayfinder Verified Content</title>
  <link rel="stylesheet" href="verification.css">
</head>
<body>
  <!-- Header with search bar and verification badge -->
  <header id="header">
    <div class="search-container">
      <input type="text" id="search-input" placeholder="Enter ArNS name or txId...">
      <button id="search-btn">Explore</button>
    </div>
    <div id="verification-badge"></div>
    <button id="settings-btn">Settings</button>
  </header>

  <!-- Loading screen (shown during verification) -->
  <div id="loading-screen" class="hidden">
    <!-- Phase indicators, progress bar, resource log -->
  </div>

  <!-- Content iframe (shown after verification) -->
  <iframe
    id="content-frame"
    class="hidden"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
  ></iframe>

  <!-- Error display -->
  <div id="error-display" class="hidden"></div>

  <script src="verification.js" type="module"></script>
</body>
</html>
```

### 2. Verification Loading Screen

Port the `VerificationLoadingScreen` component logic:

- Phase indicators (Resolving → Fetching → Verifying)
- Progress bar with percentage
- Recent resource activity log (for manifests)
- Gateway and elapsed time display
- Different display for single files vs manifests

### 3. Verification Badge

Port the `VerificationBadge` component logic:

- States: verifying, verified, failed, partial
- Expandable details panel
- Resource statistics
- Failed resources list
- Strict mode warning

---

## Implementation Plan

### Phase 1: Foundation (Core Infrastructure)

1. **Create verification directory structure**
   ```
   src/verification/
   ├── verification-sw.ts      # Service worker
   ├── verification.html       # Page HTML
   ├── verification.ts         # Page script
   ├── verification.css        # Styles
   ├── verified-cache.ts       # Cache implementation
   ├── verification-state.ts   # State management
   ├── manifest-verifier.ts    # Verification logic
   ├── location-patcher.ts     # Location patching
   ├── gateway-health.ts       # Health tracking
   ├── types.ts                # Type definitions
   └── sw-messaging.ts         # Message helpers
   ```

2. **Port core utilities from wayfinder-app**
   - `verified-cache.ts` - Direct port with minor adjustments
   - `verification-state.ts` - Direct port
   - `gateway-health.ts` - Direct port
   - `location-patcher.ts` - Direct port

3. **Create TypeScript types**
   ```typescript
   // types.ts
   export interface ArweaveManifest { ... }
   export interface ManifestVerificationState { ... }
   export interface VerificationEvent { ... }
   export interface SwWayfinderConfig { ... }
   export interface VerifiedResource { ... }
   ```

### Phase 2: Service Worker Implementation

1. **Port manifest-verifier.ts**
   - Adapt `resolveArnsToTxId` for extension context
   - Port `selectWorkingGateway` with health checking
   - Port `fetchAndVerifyRawContent`
   - Port `verifyAllResources` with concurrency control
   - Port `verifyIdentifier` main orchestration

2. **Implement verification-sw.ts**
   - Install/activate lifecycle
   - Message handlers for INIT_WAYFINDER, CLEAR_CACHE, CLEAR_VERIFICATION
   - Fetch interception for /ar-proxy/
   - Absolute path interception for active manifests

3. **Create sw-messaging.ts helper**
   ```typescript
   export class VerificationSwMessenger {
     async register(): Promise<void>
     async initializeWayfinder(config: SwWayfinderConfig): Promise<void>
     async clearCache(): Promise<void>
     async clearVerification(identifier: string): Promise<void>
     on(type: string, callback: (event: VerificationEvent) => void): () => void
     isControlling(): boolean
   }
   ```

### Phase 3: Verification Page UI

1. **Create verification.html**
   - Header with search and badge
   - Loading screen structure
   - Content iframe
   - Error display

2. **Port CSS from wayfinder-app**
   - Use existing extension design system
   - Add verification-specific styles
   - Loading animations
   - Toast/badge styles

3. **Implement verification.ts**
   - Parse `?q=` parameter
   - Register service worker
   - Initialize Wayfinder with config
   - Handle verification events
   - Update loading screen UI
   - Manage iframe display
   - Handle retry mechanism

### Phase 4: Integration with Background Script

1. **Add verified mode option**
   ```typescript
   // In handleBeforeNavigate
   const { verifiedMode } = await chrome.storage.local.get('verifiedMode');

   if (verifiedMode) {
     // Redirect to verification page
     chrome.tabs.update(details.tabId, {
       url: chrome.runtime.getURL('verification.html') + `?q=${encodeURIComponent(arUrl)}`
     });
   } else {
     // Existing direct gateway routing
     const result = await getRoutableGatewayUrl(arUrl);
     chrome.tabs.update(details.tabId, { url: result.url });
   }
   ```

2. **Update manifest.json**
   ```json
   {
     "web_accessible_resources": [
       {
         "resources": ["verification.html", "verification.js", "verification-sw.js", "**/*"],
         "matches": ["<all_urls>"]
       }
     ]
   }
   ```

3. **Add settings toggle for verified mode**
   - Add to settings.html
   - Add to settings.ts
   - Store in chrome.storage.local

### Phase 5: Trusted Gateway Integration

1. **Port trustedGateways.ts logic**
   - Fetch top staked gateways via @ar.io/sdk
   - Cache in chrome.storage.local (24 hours)
   - Configurable trusted gateway count

2. **Port routing gateways logic**
   - Fetch from arweave.net/ar-io/peers
   - Shuffle for load distribution
   - Use existing gateway registry as fallback

### Phase 6: Polish and Testing

1. **Error handling**
   - Graceful degradation on verification failure
   - Clear error messages
   - Retry mechanism

2. **Performance optimization**
   - Tune concurrency settings
   - Optimize cache size
   - Profile verification speed

3. **Testing**
   - Test with various ArNS names
   - Test with txIds (single files and manifests)
   - Test large manifests (100+ resources)
   - Test offline/slow network scenarios
   - Test strict mode blocking

---

## Chrome Extension Considerations

### Manifest V3 Service Worker Limitations

| Challenge | Solution |
|-----------|----------|
| Background SW can't intercept page requests | Use dedicated verification page with its own SW scope |
| No DOM access in SW | All UI in verification page, SW only handles fetch |
| SW can terminate | Use persistent state in Map (lost on restart, but reconstructible) |
| No persistent connections | Use chrome.storage for configuration |

### Service Worker Scope

```
Extension Root
├── background.js           # Extension SW (chrome-extension://{id}/)
└── verification/
    ├── verification.html   # Page at chrome-extension://{id}/verification/verification.html
    └── verification-sw.js  # SW scope: chrome-extension://{id}/verification/
```

The verification service worker has scope `/verification/`, so it can intercept:
- `/verification/ar-proxy/{identifier}/`
- Any absolute paths when they match the active manifest

### Trusted Gateway Fetching

Use `@ar.io/sdk` the same way as in wayfinder-app:

```typescript
import { ARIO } from '@ar.io/sdk';

async function fetchTrustedGateways(count: number = 3): Promise<GatewayWithStake[]> {
  const ario = ARIO.mainnet();
  const result = await ario.getGateways({ limit: 1000 });

  // Filter active, sort by total stake, take top N
  const sorted = result.items
    .filter(g => g.status === 'joined' && g.settings?.fqdn)
    .map(g => ({
      url: `https://${g.settings.fqdn}`,
      totalStake: (g.operatorStake || 0) + (g.totalDelegatedStake || 0),
    }))
    .sort((a, b) => b.totalStake - a.totalStake);

  return sorted.slice(0, count);
}
```

### Iframe Security

Use the same sandbox attributes as wayfinder-app:
```html
<iframe
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
>
```

---

## Code Migration Strategy

### Files to Port Directly (minimal changes)

| wayfinder-app File | Extension Target | Changes Needed |
|--------------------|------------------|----------------|
| `service-worker/verified-cache.ts` | `verification/verified-cache.ts` | None |
| `service-worker/verification-state.ts` | `verification/verification-state.ts` | None |
| `service-worker/gateway-health.ts` | `verification/gateway-health.ts` | None |
| `service-worker/location-patcher.ts` | `verification/location-patcher.ts` | None |
| `service-worker/types.ts` | `verification/types.ts` | Minimal |
| `service-worker/logger.ts` | `verification/logger.ts` | None |

### Files to Adapt

| wayfinder-app File | Extension Target | Changes Needed |
|--------------------|------------------|----------------|
| `service-worker/manifest-verifier.ts` | `verification/manifest-verifier.ts` | Remove wayfinder-instance dependency, use HashVerificationStrategy directly |
| `service-worker/wayfinder-instance.ts` | `verification/wayfinder-config.ts` | Simplify to just config management |
| `service-worker/service-worker.ts` | `verification/verification-sw.ts` | Adapt for extension SW context |
| `utils/trustedGateways.ts` | `verification/trusted-gateways.ts` | Use chrome.storage instead of localStorage |
| `utils/serviceWorkerMessaging.ts` | `verification/sw-messaging.ts` | Adapt for extension context |

### Files to Create New

| File | Purpose |
|------|---------|
| `verification/verification.html` | Main verification page |
| `verification/verification.ts` | Page script with UI logic |
| `verification/verification.css` | Styles (adapt from wayfinder-app) |
| `verification/polyfills.ts` | SW polyfills if needed |

### Shared Code with wayfinder-core

The extension can leverage these from `@ar.io/wayfinder-core`:

```typescript
import {
  HashVerificationStrategy,
  SignatureVerificationStrategy,
  // For URL construction
  // For hash utilities
} from '@ar.io/wayfinder-core';
```

---

## Configuration Schema

### Extension Storage

```typescript
interface VerificationConfig {
  // Enable/disable verified mode
  verifiedMode: boolean;

  // Verification method: 'hash' (fast) or 'signature' (cryptographic)
  verificationMethod: 'hash' | 'signature';

  // Strict mode: block content on verification failure
  strictMode: boolean;

  // Number of trusted gateways to use (1-10)
  trustedGatewayCount: number;

  // Concurrency for parallel resource verification
  verificationConcurrency: number;

  // Cache TTL for trusted gateways (ms)
  trustedGatewayCacheTTL: number;
}

// Default values
const VERIFICATION_DEFAULTS: VerificationConfig = {
  verifiedMode: false,
  verificationMethod: 'hash',
  strictMode: false,
  trustedGatewayCount: 3,
  verificationConcurrency: 10,
  trustedGatewayCacheTTL: 24 * 60 * 60 * 1000, // 24 hours
};
```

---

## Testing Checklist

### Unit Tests
- [ ] Cache LRU eviction works correctly
- [ ] Verification state transitions are correct
- [ ] ArNS resolution handles consensus correctly
- [ ] Hash verification detects mismatches
- [ ] Location patcher injects correctly

### Integration Tests
- [ ] Single file verification (txId)
- [ ] ArNS name resolution + verification
- [ ] Manifest parsing and resource verification
- [ ] Large manifest (100+ resources)
- [ ] Failed resource handling (partial verification)
- [ ] Retry mechanism with fresh gateways
- [ ] Absolute path interception for SPAs

### End-to-End Tests
- [ ] Navigate to ar:// URL in verified mode
- [ ] Loading screen shows progress
- [ ] Content displays after verification
- [ ] Verification badge shows correct status
- [ ] Settings persist across sessions
- [ ] Cache persists across page reloads

### Edge Cases
- [ ] Network timeout during verification
- [ ] All trusted gateways fail
- [ ] Manifest with circular references
- [ ] Very large files (>100MB)
- [ ] Invalid manifest format
- [ ] ArNS resolution disagreement (security check)

---

## Appendix: Key Code Snippets from wayfinder-app

### Hash Computation

```typescript
// From manifest-verifier.ts
async function computeHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

### ArNS Consensus Checking

```typescript
// From manifest-verifier.ts - simplified
async function resolveArnsToTxId(arnsName: string, trustedGateways: string[]) {
  const results = await Promise.allSettled(
    trustedGateways.map(async (gateway) => {
      const gatewayUrl = new URL(gateway);
      const arnsUrl = `https://${arnsName}.${gatewayUrl.host}`;
      const response = await fetch(arnsUrl, { method: 'HEAD' });
      const txId = response.headers.get('x-arns-resolved-id');
      return { txId, gateway };
    })
  );

  const successful = results.filter(r => r.status === 'fulfilled');
  const txIds = [...new Set(successful.map(r => r.value.txId))];

  if (txIds.length > 1) {
    throw new Error('ArNS resolution mismatch - security issue');
  }

  return { txId: txIds[0], gateway: successful[0].value.gateway };
}
```

### Event Broadcasting

```typescript
// From verification-state.ts
export async function broadcastEvent(event: VerificationEvent): Promise<void> {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'VERIFICATION_EVENT',
      event,
    });
  });
}
```

---

## Summary

This design document outlines how to extend the Wayfinder Chrome Extension with full content verification capabilities, mirroring the wayfinder-app implementation. The key architectural decision is using a dedicated verification page with its own service worker scope, rather than trying to intercept all requests from the background service worker.

The implementation follows the same security model as wayfinder-app:
1. Trusted gateways for hash/signature verification (high-stake selection)
2. Routing gateways for content fetching (broader pool)
3. Manifest verification before trusting path→txId mappings
4. LRU cache for verified content
5. Progress tracking and UI feedback

The modular design allows most code to be directly ported from wayfinder-app, with adaptations mainly for Chrome extension context (storage, messaging, SW scope).
