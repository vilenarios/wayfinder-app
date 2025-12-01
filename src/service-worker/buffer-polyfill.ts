/**
 * Buffer polyfill for service worker
 * crypto-browserify and other dependencies need Buffer available globally
 * Must be imported before any code that might reference Buffer
 */

import { Buffer } from 'buffer';

declare const self: ServiceWorkerGlobalScope;

// Install Buffer on globalThis so it's available everywhere
// Requires 'any' casts for adding non-standard properties
/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as any).Buffer = Buffer;
(self as any).Buffer = Buffer;
/* eslint-enable @typescript-eslint/no-explicit-any */

export { Buffer };
