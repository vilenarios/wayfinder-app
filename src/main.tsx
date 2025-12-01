// Load polyfills first for Arweave crypto dependencies
import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { swMessenger } from './utils/serviceWorkerMessaging'

// Proactively register the service worker at app startup.
// This ensures the SW is installed and controlling the page before
// the user enables verification, eliminating race conditions.
// The SW remains dormant until it receives INIT_WAYFINDER message.
swMessenger.registerProactive(
  import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/service-worker.js',
  import.meta.env.DEV ? { type: 'module' } : undefined
).catch(err => {
  // Non-fatal: verification will still work after a page reload
  console.warn('[App] Service worker registration failed:', err);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
