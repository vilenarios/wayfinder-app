/**
 * CommonJS compatibility polyfill for service worker
 * Some dependencies use CommonJS exports/module.exports which don't exist in ES modules
 * Must be imported FIRST before any other imports
 */

declare const self: ServiceWorkerGlobalScope;

// Create CommonJS-like module/exports objects
const moduleShim = { exports: {} };
const exportsShim = moduleShim.exports;

// Install on globalThis and self
// Requires 'any' casts for adding non-standard properties
/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as any).module = moduleShim;
(globalThis as any).exports = exportsShim;
(self as any).module = moduleShim;
(self as any).exports = exportsShim;
/* eslint-enable @typescript-eslint/no-explicit-any */

export {};
