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
      },
      injectRegister: null, // Don't auto-inject registration
      manifest: false, // Don't generate web manifest
      devOptions: {
        enabled: true, // Enable service worker in dev mode
        type: 'module',
      },
    }),
  ],
  ...(command === 'build' && {
    resolve: {
      alias: {
        // Provide browser-compatible polyfills for Node.js crypto modules (production only)
        crypto: 'crypto-browserify',
        stream: 'stream-browserify',
        buffer: 'buffer',
        events: 'events',
      },
    },
  }),
  define: {
    // Required for dependencies that check for Node.js globals
    global: 'globalThis',
    'process.env': '{}',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
}))
