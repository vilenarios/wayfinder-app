import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
      },
    },
  }),
  define: {
    // Required for dependencies that check for Node.js globals
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
}))
