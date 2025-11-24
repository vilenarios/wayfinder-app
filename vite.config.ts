import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
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
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          sw: resolve(__dirname, 'src/service-worker/service-worker.ts'),
        },
        output: {
          entryFileNames: (chunkInfo) => {
            // Service worker goes to public root
            if (chunkInfo.name === 'sw') {
              return 'service-worker.js';
            }
            return 'assets/[name]-[hash].js';
          },
        },
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
