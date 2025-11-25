import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/service-worker',
      filename: 'service-worker.ts',
      injectManifest: {
        globPatterns: [], // Don't precache anything
        injectionPoint: undefined, // We don't use injection
        // Use IIFE format to avoid CommonJS/ESM interop issues
        // IIFE wraps everything in a function scope, avoiding bare exports references
        rollupFormat: 'iife',
      },
      injectRegister: null, // Don't auto-inject registration
      manifest: false, // Don't generate web manifest
      devOptions: {
        enabled: true, // Enable service worker in dev mode
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      // Provide browser-compatible polyfills for Node.js modules
      // Note: crypto-browserify doesn't work in Vite dev mode due to ESM issues
      // Crypto polyfills only applied in production build
      util: 'util',
      ...(command === 'build' && {
        crypto: 'crypto-browserify',
        stream: 'stream-browserify',
        buffer: 'buffer',
        events: 'events',
      }),
    },
  },
  define: {
    // Required for dependencies that check for Node.js globals
    global: 'globalThis',
    // Define process fully for service worker and other modules
    'process.env': '{}',
    'process.browser': 'true',
    'process.version': '""',
  },
  build: {
    // Ensure CommonJS modules are properly transformed
    commonjsOptions: {
      transformMixedEsModules: true,
      // Ensure exports/module are available
      requireReturnsDefault: 'auto',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  // Worker-specific configuration for service worker builds
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
}))
