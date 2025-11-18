# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React web application for accessing Arweave content through the AR.IO Network using Wayfinder. It allows users to search by ArNS names or transaction IDs and view content through an optimized gateway routing system.

**Tech Stack**: React 18, TypeScript, Vite, Tailwind CSS, @ar.io/wayfinder-react

## Development Commands

```bash
# Development server (typically runs on http://localhost:5173)
npm run dev

# Production build (outputs to dist/)
npm run build

# Preview production build locally
npm run preview

# Run linter
npm run lint
```

## Local Development with Wayfinder Packages

This app uses local Wayfinder packages from a sibling monorepo directory (`../wayfinder`). The packages are linked via file paths in package.json:

```json
{
  "@ar.io/wayfinder-react": "file:../wayfinder/packages/wayfinder-react",
  "@ar.io/wayfinder-core": "file:../wayfinder/packages/wayfinder-core"
}
```

**Before running this app**, ensure the Wayfinder monorepo packages are built:

```bash
cd ../wayfinder
npm install
npm run build
cd ../wayfinder-app
npm install
```

If you encounter module resolution errors, rebuild the Wayfinder packages and reinstall dependencies in this app.

## Architecture

### State Management Pattern

The app uses React Context for configuration management with localStorage persistence:

1. **WayfinderConfigContext** (src/context/WayfinderConfigContext.tsx): Manages user settings
   - Routing strategy selection (random, fastest ping, round robin, preferred gateway)
   - Telemetry preferences
   - Settings flyout open/close state
   - Auto-saves to localStorage on changes (key: `wayfinder-app-config`)

2. **WayfinderProvider** from @ar.io/wayfinder-react: Manages gateway routing and URL resolution
   - Receives configuration from WayfinderConfigContext
   - Re-initializes when config changes (via key prop in App.tsx:67)
   - Provides `useWayfinderUrl` hook for resolving ar:// URLs to gateway URLs
   - **Critical**: Must be configured with `routingSettings.strategy` or it will have no gateways available
   - Uses `TrustedPeersGatewaysProvider` to fetch gateway list from arweave.net
   - Wraps provider with `SimpleCacheGatewaysProvider` for 5-minute caching

### Component Hierarchy

```
App (WayfinderConfigProvider wrapper)
└── AppContent (WayfinderProvider wrapper)
    ├── SearchBar - Input UI with centered/top layout states
    ├── ContentViewer - Iframe wrapper using useWayfinderUrl hook
    └── SettingsFlyout - Settings panel (overlay)
```

### Input Detection Logic

The app automatically detects input type using `detectInputType()` (src/utils/detectInputType.ts):

- **Transaction ID**: Exactly 43 characters matching `/^[A-Za-z0-9_-]{43}$/`
- **ArNS Name**: Everything else (1-51 chars, case-insensitive alphanumeric with dashes/underscores)

ContentViewer.tsx:12-13 uses this to pass the correct params to `useWayfinderUrl`:
```typescript
const inputType = detectInputType(input);
const params = inputType === 'txId' ? { txId: input } : { arnsName: input };
```

### URL Resolution Flow

1. User enters ArNS name or txId → SearchBar
2. Input validated and passed to ContentViewer
3. ContentViewer calls `detectInputType()` to determine param type
4. `useWayfinderUrl()` hook resolves ar:// URL to gateway URL based on routing strategy
5. Iframe loads the resolved URL

### Gateway Configuration

The app configures Wayfinder with a gateway provider in App.tsx:31-64:

1. **TrustedPeersGatewaysProvider**: Fetches dynamic gateway list from arweave.net's `/ar-io/peers` endpoint
2. **SimpleCacheGatewaysProvider**: Caches gateway list for 5 minutes to reduce API calls
3. **createRoutingStrategy**: Maps user's routing strategy choice to actual Wayfinder routing strategy instances

The routing strategy configuration is recreated whenever the user changes their routing preference, telemetry settings, or preferred gateway URL. The WayfinderProvider is keyed by the full config JSON to force re-initialization on changes.

### Settings Persistence

Settings are stored in localStorage with the key `wayfinder-app-config` (src/utils/constants.ts:3). The context initializes from localStorage on mount and saves on every config change (src/context/WayfinderConfigContext.tsx:22-28).

## Design System

The app uses the AR.IO Wayfinder extension dark theme. All colors are defined in tailwind.config.js:

- **Backgrounds**: `container-L0` through `container-L3` (darkest to lightest)
- **Text**: `text-high` (#cacad6) for primary, `text-low` (#7f7f87) for secondary
- **Accents**: `accent-teal-primary` (#2dd3be) for primary actions, `accent-teal-secondary` for hover states
- **Borders**: `stroke-low` and `stroke-high` (semi-transparent white)

**Typography**:
- Primary font: Rubik (loaded from Google Fonts in index.html)
- Secondary: Inter
- Monospace: JetBrains Mono

When styling components, use the custom Tailwind classes (e.g., `bg-container-L1`, `text-text-high`, `border-stroke-low`) rather than default Tailwind colors.

## iframe Security Configuration

The ContentViewer iframe (src/components/ContentViewer.tsx:46) uses these sandbox attributes:
- `allow-scripts` - Required for interactive content
- `allow-same-origin` - Required for certain content types
- `allow-forms` - Allows form submissions
- `allow-popups` - Allows opening new windows
- `allow-popups-to-escape-sandbox` - Required for some navigation

These settings balance functionality with security for displaying arbitrary Arweave content.

## Common Patterns

### Adding a New Routing Strategy

1. Add type to `RoutingStrategy` union in src/types/index.ts:1
2. Add option to `ROUTING_STRATEGY_OPTIONS` in src/utils/constants.ts:10
3. Update SettingsFlyout.tsx to handle new strategy UI if needed
4. Wayfinder library handles the actual routing logic

### Modifying Configuration Schema

1. Update `WayfinderConfig` interface in src/types/index.ts:3
2. Update `DEFAULT_CONFIG` in src/utils/constants.ts:5
3. Update `wayfinderConfig` construction in App.tsx:26
4. Update SettingsFlyout.tsx UI to expose new setting

### Error Handling Pattern

All components using Wayfinder hooks (like ContentViewer) receive `{ resolvedUrl, isLoading, error }`. Always check states in order:
1. Check `isLoading` → show LoadingSpinner
2. Check `error` → show ErrorDisplay with retry handler
3. Check `resolvedUrl` validity → show content or fallback

## Troubleshooting

**"No gateways available" error**: The WayfinderProvider requires `routingSettings.strategy` to be configured. Check App.tsx:31-64 to ensure:
- `TrustedPeersGatewaysProvider` is initialized with a valid trusted gateway URL
- `createRoutingStrategy` is called with the gatewaysProvider
- `routingSettings.strategy` is passed to WayfinderProvider

**Build errors about missing modules**: Rebuild the Wayfinder monorepo packages (`cd ../wayfinder && npm run build`)

**Content doesn't load**: Check browser console for CSP errors. Some Arweave content may block iframe embedding.

**Settings not persisting**: Check browser localStorage isn't disabled/full. Clear localStorage and reload to reset to defaults.

**Type errors after dependency updates**: Ensure @ar.io/wayfinder-react and @ar.io/wayfinder-core versions are compatible and both properly built.
