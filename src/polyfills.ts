// Browser polyfills for Node.js modules required by Arweave dependencies
import { Buffer } from 'buffer';

// Set up polyfills synchronously before any dependencies load
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
  (window as any).global = window;

  // Initialize process.env if not already defined
  if (!(window as any).process) {
    (window as any).process = {
      env: {},
      version: '',
      nextTick: (fn: () => void) => Promise.resolve().then(fn),
    };
  }
}
