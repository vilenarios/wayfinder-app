# Wayfinder App

A clean, simple web application for accessing Arweave content through the AR.IO Network using Wayfinder.

## Features

- **Simple Search Interface**: Enter an ArNS name or transaction ID to view Arweave content
- **Gateway Routing**: Automatically routes requests through optimal AR.IO gateways
- **Configurable Settings**: Choose routing strategies and customize gateway preferences
- **Iframe Display**: View any Arweave content directly in the browser
- **Persistent Settings**: Configuration saved locally in browser storage

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open your browser to the URL shown in the terminal (typically `http://localhost:5173`)

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

### Preview Production Build

```bash
npm run preview
```

## Usage

### Basic Search

1. Enter an ArNS name (e.g., `ardrive`, `vilenarios`) or a 43-character transaction ID
2. Click "Explore" to load the content
3. The search bar moves to the top, and content appears in an iframe below

### Settings

Click the ⚙️ Settings button to configure:

#### Routing Strategies

- **Random**: Randomly selects a gateway for load balancing (default)
- **Fastest Ping**: Tests gateway latency and uses the fastest one (cached for 5 minutes)
- **Round Robin**: Cycles through gateways sequentially for balanced distribution
- **Preferred Gateway**: Use a specific gateway URL with automatic fallback

#### Advanced Options

- **Telemetry**: Enable/disable anonymous usage data collection (disabled by default)

All settings are saved automatically in your browser's localStorage.

## Project Structure

```
wayfinder-app/
├── src/
│   ├── components/          # React components
│   │   ├── SearchBar.tsx    # Search input with centered/top states
│   │   ├── ContentViewer.tsx # Iframe wrapper for Arweave content
│   │   ├── SettingsFlyout.tsx # Settings panel
│   │   ├── LoadingSpinner.tsx # Loading indicator
│   │   └── ErrorDisplay.tsx  # Error message component
│   ├── context/
│   │   └── WayfinderConfigContext.tsx # Settings state management
│   ├── utils/
│   │   ├── detectInputType.ts # Detect txId vs arnsName
│   │   └── constants.ts      # App constants and defaults
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   ├── App.tsx               # Main app component
│   ├── main.tsx              # Entry point
│   └── index.css             # Global styles with Tailwind
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **@ar.io/wayfinder-react** - Arweave routing and gateway selection
- **@ar.io/wayfinder-core** - Core Wayfinder functionality

## How It Works

1. **User Input**: Enter an ArNS name or transaction ID
2. **Detection**: App automatically detects input type using regex patterns
3. **Gateway Selection**: Wayfinder selects optimal gateway based on routing strategy
4. **URL Resolution**: Converts `ar://` URLs to actual gateway URLs
5. **Display**: Content loads in iframe with proper sandbox attributes

## Input Formats

### ArNS Names
- Lowercase alphanumeric with dashes/underscores
- 1-51 characters
- Examples: `ardrive`, `vilenarios`, `my-app`

### Transaction IDs
- Exactly 43 characters
- Base64url pattern: `[A-Za-z0-9_-]{43}`
- Example: `KKmRbIfrc7wiLcG0zvY1etlO0NBx1926dSCksxCIN3A`

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Local Development with Wayfinder Packages

This app uses local Wayfinder packages from the monorepo via file paths in `package.json`:

```json
{
  "@ar.io/wayfinder-react": "file:../wayfinder/packages/wayfinder-react",
  "@ar.io/wayfinder-core": "file:../wayfinder/packages/wayfinder-core"
}
```

Make sure the Wayfinder monorepo is built before running this app:

```bash
cd ../wayfinder
npm install
npm run build
cd ../wayfinder-app
npm install
```

## Security Considerations

The iframe uses these sandbox attributes:
- `allow-scripts` - Required for interactive content
- `allow-same-origin` - Required for certain content types
- `allow-forms` - Allows form submissions
- `allow-popups` - Allows opening new windows
- `allow-popups-to-escape-sandbox` - Required for some navigation

These settings balance functionality with security. Adjust based on your security requirements.

## Troubleshooting

### Content doesn't load

- Verify the ArNS name or transaction ID is correct
- Check browser console for errors
- Try a different routing strategy in settings
- Some content may not support iframe embedding due to CSP headers

### Gateway errors

- The selected gateway might be down - try changing routing strategy
- Check network connection
- Clear browser cache and localStorage

### Build errors

- Ensure Wayfinder packages are built: `cd ../wayfinder && npm run build`
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Clear Vite cache: `rm -rf node_modules/.vite`

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Links

- [GitHub Repository](https://github.com/vilenarios/wayfinder-app)
- [Wayfinder Library](https://github.com/ar-io/wayfinder)
- [AR.IO Network](https://ar.io)
- [Arweave](https://arweave.org)
