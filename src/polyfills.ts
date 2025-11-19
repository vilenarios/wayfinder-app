// Browser polyfills for Node.js modules required by Arweave dependencies
// Only needed in production builds where crypto modules are aliased to browser versions
if (import.meta.env.PROD) {
  // Dynamic import only in production to avoid loading buffer package in dev
  import('buffer').then(({ Buffer }) => {
    if (typeof window !== 'undefined') {
      (window as any).Buffer = Buffer;
      (window as any).global = window;
      if (!(window as any).process) {
        (window as any).process = { env: {} };
      }
    }
  });
}
