# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React web application for accessing Arweave content through the AR.IO Network using Wayfinder. It allows users to search by ArNS names or transaction IDs and view content through an optimized gateway routing system.

**Tech Stack**: React 18, TypeScript, Vite, Tailwind CSS, @ar.io/wayfinder-react

**Note**: This app requires Node.js crypto polyfills for browser compatibility. Polyfills are loaded in src/polyfills.ts before the React app initializes.

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

## Dependencies

The app uses published Wayfinder packages from npm:
- `@ar.io/wayfinder-react`: ^1.0.26
- `@ar.io/wayfinder-core`: (peer dependency)

For local development with unpublished Wayfinder changes, you can link to a sibling monorepo:

```json
{
  "@ar.io/wayfinder-react": "file:../wayfinder/packages/wayfinder-react",
  "@ar.io/wayfinder-core": "file:../wayfinder/packages/wayfinder-core"
}
```

If using local packages, ensure the Wayfinder monorepo is built first:

```bash
cd ../wayfinder
npm install
npm run build
cd ../wayfinder-app
npm install
```

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
└── WayfinderWrapper (WayfinderProvider configuration)
    └── AppContent (Main UI state management)
        ├── SearchBar - Input UI with centered/top layout states
        │   - Supports standard search (loads in iframe)
        │   - Supports CMD/CTRL+Enter for open-in-new-tab
        │   - Shows collapse/expand controls when content is loaded
        ├── ContentViewer - Iframe wrapper using useWayfinderUrl hook
        │   - Memoized to prevent unnecessary re-renders
        │   - Keyed by input and searchCounter for retry mechanism
        └── SettingsFlyout - Settings panel (overlay)
```

**Key State Management**:
- `searchInput`: Current search query (synced with URL ?q= parameter)
- `searchCounter`: Incremented on retry to force new gateway selection
- `resolvedUrl`: Current resolved gateway URL (passed to parent for "Open in new tab" button)
- `shouldAutoOpenInNewTab`: Flag for CMD/CTRL+Enter behavior

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

1. User enters ArNS name or txId → SearchBar (or via `?q=` URL parameter on page load)
2. Input validated and passed to ContentViewer
3. ContentViewer calls `detectInputType()` to determine param type
4. `useWayfinderUrl()` hook resolves ar:// URL to gateway URL based on routing strategy
5. Iframe loads the resolved URL (or new tab if CMD/CTRL+Enter was used)

**URL Query Parameter Support**: The app reads the `?q=` parameter on mount (App.tsx:107-115) to auto-execute searches. When users search, the URL updates with the query parameter to support browser back/forward navigation and direct links. Browser back/forward buttons are handled via the `popstate` event listener (App.tsx:117-131).

**Open in New Tab**: Users can press CMD/CTRL+Enter in the search bar to resolve the URL and immediately open it in a new tab instead of loading it in the iframe. The app sets `shouldAutoOpenInNewTab` flag and uses a useEffect (App.tsx:184-191) to open the tab once the URL resolves.

### Gateway Configuration

The app configures Wayfinder with a gateway provider in App.tsx:20-72:

1. **TrustedPeersGatewaysProvider**: Fetches dynamic gateway list from arweave.net's `/ar-io/peers` endpoint
2. **Gateway Limiting**: Randomly selects 10 gateways from the full list using Fisher-Yates shuffle algorithm (App.tsx:27-42) to reduce spam and improve performance
3. **SimpleCacheGatewaysProvider**: Caches gateway list for 5 minutes to reduce API calls
4. **createRoutingStrategy**: Maps user's routing strategy choice to actual Wayfinder routing strategy instances
   - 'roundRobin' is mapped to 'balanced' for the Wayfinder core library
   - 'preferred' uses `StaticRoutingStrategy` which always returns the user's specified gateway (no ping checks or fallback)

The routing strategy configuration is recreated whenever the user changes their routing preference, telemetry settings, or preferred gateway URL. The WayfinderProvider is keyed by routing strategy and preferred gateway (App.tsx:88) to force re-initialization only when necessary.

### Gateway Retry Mechanism

When content fails to load, users can click "Retry with different gateway" which increments a `searchCounter` state. The ContentViewer component is keyed by `${searchInput}-${searchCounter}` (App.tsx:211) which forces React to unmount and remount the component with a fresh gateway selection from the routing strategy.

### Settings Persistence

Settings are stored in localStorage with the key `wayfinder-app-config` (src/utils/constants.ts:3). The context initializes from localStorage on mount and saves on every config change (src/context/WayfinderConfigContext.tsx:22-28).

## Design System

The app uses the AR.IO Wayfinder extension design system, which matches the Figma design tokens exactly. The design system is implemented through both Tailwind CSS classes and CSS custom properties.

### Color System

Colors are defined in tailwind.config.js and as CSS custom properties in index.css:

**Containers** (backgrounds, layers):
- `container-L0`: #050505 (deep black)
- `container-L1`: #0e0e0f (main background)
- `container-L2`: #1c1c1f (cards, elevated surfaces)
- `container-L3`: #2a2a2e (highly elevated elements)

**Text**:
- `text-high`: #cacad6 (high contrast, primary text)
- `text-low`: #7f7f87 (low contrast, secondary text)
- `text-white`: #ffffff (pure white)

**Icons**:
- `icon-high`: #cacad6 (high contrast icons)
- `icon-mid`: #a3a3ad (medium contrast icons)
- `icon-low`: #7f7f87 (low contrast icons)

**Accents**:
- Teal Primary: #2dd3be (primary actions, brand color)
- Teal Secondary: #0d9085 (hover states)
- Teal Tertiary: #bc123c (red accent)
- Blue: #0055fe (blue accent)
- Blue Light: #6a82fc (light blue variant)

**Strokes/Borders**:
- `stroke-low`: rgba(202, 202, 214, 0.08) (subtle borders)
- `stroke-high`: rgba(202, 202, 214, 0.32) (emphasis borders)
- `border-default`: rgba(255, 255, 255, 0.2)

**Semantic Colors**:
- Success: rgba(211, 255, 202, 0.8) / #22c55e
- Warning: #fcb823 / #f59e0b
- Error: #f23f5d / #ef4444
- Info: #6a82fc / #3b82f6

**Gradients**:
- Primary gradient: `linear-gradient(135deg, #f7c3a1, #df9be8)` (peach to purple)
- Teal gradient: `linear-gradient(135deg, #2dd3be, #0d9085)`
- Available as Tailwind classes: `bg-gradient-primary`, `bg-gradient-teal`

### Typography System

**Font Families**:
- Primary: Rubik (loaded from Google Fonts in index.html)
- Secondary: Inter
- Monospace: JetBrains Mono
- Headings use `font-rubik` or `font-sans`

**Font Sizes** (extension system):
- Display: 60px / line-height 1.2 / weight 700
- H1-H6: 50px, 42px, 35px, 29px, 24px, 17px
- Paragraphs: 24px (xxlarge), 20px (xlarge), 17px (large), 14px (normal), 12px (small)
- Caption: 11px / weight 400 or 700

**Usage in Tailwind**:
- Use semantic sizes: `text-h1`, `text-p-normal`, `text-caption-bold`
- Or standard scale: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`

### Spacing System

Extension spacing scale (in tailwind.config.js):
- `spacing-xs`: 4px
- `spacing-sm`: 8px
- `spacing-md`: 16px
- `spacing-lg`: 24px
- `spacing-xl`: 32px
- `spacing-2xl`: 48px

Use in Tailwind as: `p-md`, `m-lg`, `gap-sm`, etc.

### Shadows

**Card Shadow** (Figma design):
```css
--shadow-card: 0px 1726px 483px rgba(0,0,0,0.01),
               0px 1105px 442px rgba(0,0,0,0.04),
               0px 621px 373px rgba(0,0,0,0.15),
               0px 276px 276px rgba(0,0,0,0.26),
               0px 69px 152px rgba(0,0,0,0.29);
```

**Standard Shadows**:
- `shadow-sm`: 0 1px 2px rgba(0, 0, 0, 0.3)
- `shadow-md`: 0 4px 6px -1px rgba(0, 0, 0, 0.4)
- `shadow-lg`: 0 10px 15px -3px rgba(0, 0, 0, 0.5)

### Border Radius

- `rounded-sm`: 4px
- `rounded-md`: 8px
- `rounded-lg`: 12px
- `rounded-xl`: 16px

### Transitions

CSS custom properties for transitions:
- `--transition-fast`: 0.2s ease
- `--transition-base`: 0.3s ease
- `--transition-slow`: 0.4s ease

Tailwind easing: `ease-smooth` (cubic-bezier(0.4, 0, 0.2, 1))

### Utility Classes

**Scrollbar Styling**:
- `.scrollbar-styled` - Custom scrollbar matching extension design
- `.scrollbar-hide` - Hide scrollbar but keep scrollability

**Animations**:
- `.icon-spin` - Spinning animation for loading icons
- `.animate-slide-in` - Slide in from bottom animation
- `.animate-pulse` - Pulsing animation

**Gradient Borders**:
- `.gradient-border` - Adds gradient border using the primary gradient

**Inline Icons**:
- `.inline-icon` - Properly aligned inline icons

### Best Practices

1. **Use Tailwind classes** for component styling: `bg-container-L1`, `text-text-high`, `border-stroke-low`
2. **Use CSS custom properties** when you need dynamic values or JavaScript access: `var(--colors-container-containerL1)`
3. **Typography**: Prefer semantic sizes (`text-p-normal`) over arbitrary values
4. **Spacing**: Use the extension spacing scale (`gap-md`, `p-lg`) for consistency
5. **Shadows**: Use `shadow-card` for elevated cards matching the extension design
6. **Gradients**: Use `bg-gradient-primary` for accent elements, borders use `.gradient-border` utility class

## Build Configuration

### Crypto Polyfills Architecture

The app uses a two-layer polyfill strategy for Node.js crypto compatibility:

1. **Runtime polyfills** (src/polyfills.ts): Loaded at app startup in main.tsx before React initializes
   - Sets up `window.Buffer`, `window.global`, and `window.process`
   - Required for Arweave dependencies that expect Node.js globals
   - Always active in both development and production

2. **Build-time polyfills** (vite.config.ts:7-16): Only applied during `npm run build`
   - Aliases Node.js modules (`crypto`, `stream`, `buffer`) to browser-compatible versions
   - Development builds skip these aliases to reduce bundle size
   - Defines `global` as `globalThis` for dependencies expecting Node.js environment

This two-layer approach ensures compatibility while optimizing development performance.

## iframe Security Configuration

The ContentViewer iframe (src/components/ContentViewer.tsx:58) uses these sandbox attributes:
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

**"No gateways available" error**: The WayfinderProvider requires `routingSettings.strategy` to be configured. Check App.tsx:20-72 to ensure:
- `TrustedPeersGatewaysProvider` is initialized with a valid trusted gateway URL
- `createRoutingStrategy` is called with the gatewaysProvider
- `routingSettings.strategy` is passed to WayfinderProvider

**Build errors about missing modules**:
- If using local Wayfinder packages, rebuild them: `cd ../wayfinder && npm run build`
- Clear Vite cache: `rm -rf node_modules/.vite`
- Reinstall dependencies: `npm install`

**Content doesn't load**:
- Check browser console for CSP errors - some Arweave content may block iframe embedding
- Try the "Retry with different gateway" button to use an alternative gateway
- Verify the ArNS name or transaction ID is correct

**Settings not persisting**: Check browser localStorage isn't disabled/full. Clear localStorage key `wayfinder-app-config` and reload to reset to defaults.

**Type errors after dependency updates**: Ensure @ar.io/wayfinder-react and @ar.io/wayfinder-core versions are compatible and both properly built.

**Crypto/Buffer errors**: If you see errors about missing crypto or Buffer globals:
- Ensure src/polyfills.ts is being imported first in main.tsx (before App component)
- For production builds, verify vite.config.ts has the build-time aliases configured
- Check that buffer, crypto-browserify, and stream-browserify are installed in devDependencies
