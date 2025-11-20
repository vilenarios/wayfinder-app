import { useState, useMemo, useCallback, useEffect } from 'react';
import { WayfinderProvider } from '@ar.io/wayfinder-react';
import {
  createRoutingStrategy,
  TrustedPeersGatewaysProvider,
  SimpleCacheGatewaysProvider,
  StaticRoutingStrategy,
  type RoutingOption,
} from '@ar.io/wayfinder-core';
import { WayfinderConfigProvider, useWayfinderConfig } from './context/WayfinderConfigContext';
import { SearchBar } from './components/SearchBar';
import { ContentViewer } from './components/ContentViewer';
import { SettingsFlyout } from './components/SettingsFlyout';

// Separate component that only handles Wayfinder configuration
function WayfinderWrapper({ children }: { children: React.ReactNode }) {
  const { config } = useWayfinderConfig();

  // Build Wayfinder configuration based on user settings
  const wayfinderConfig = useMemo(() => {
    // Create a gateways provider with caching - limit to 10 gateways to avoid spam
    const baseTrustedPeersProvider = new TrustedPeersGatewaysProvider({
      trustedGateway: 'https://arweave.net',
    });

    // Wrap with a limiting provider to randomly select 10 gateways
    const limitedProvider = {
      async getGateways() {
        const allGateways = await baseTrustedPeersProvider.getGateways();

        // Shuffle the gateways array using Fisher-Yates algorithm
        const shuffled = [...allGateways];
        for (let i = shuffled.length - 1; i > 0; i--) {
          // eslint-disable-next-line react-hooks/purity
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Return random 10 gateways
        return shuffled.slice(0, 10);
      },
    };

    const gatewaysProvider = new SimpleCacheGatewaysProvider({
      gatewaysProvider: limitedProvider,
      ttlSeconds: 5 * 60, // 5 minutes cache (in seconds) - reduced for more variety
    });

    // Map user's routing strategy to Wayfinder routing strategy
    let routingStrategy;

    if (config.routingStrategy === 'preferred') {
      // Handle preferred gateway separately
      // Trim and validate the preferred gateway URL
      const preferredGatewayRaw = config.preferredGateway?.trim();
      const preferredGateway = preferredGatewayRaw && preferredGatewayRaw.length > 0
        ? preferredGatewayRaw
        : 'https://arweave.net';

      // Use StaticRoutingStrategy to always use the preferred gateway
      // This ensures the gateway is used without ping checks or timeouts
      routingStrategy = new StaticRoutingStrategy({
        gateway: preferredGateway,
      });
    } else {
      // Map 'roundRobin' to 'balanced' for createRoutingStrategy
      const strategyName: RoutingOption =
        config.routingStrategy === 'roundRobin' ? 'balanced' : config.routingStrategy;

      routingStrategy = createRoutingStrategy({
        strategy: strategyName,
        gatewaysProvider,
      });
    }

    return {
      routingSettings: {
        strategy: routingStrategy,
      },
      telemetrySettings: {
        enabled: config.telemetryEnabled,
        // Identify this app in telemetry data sent to AR.IO
        clientName: 'wayfinder-app',
        clientVersion: '1.0.0',
        // SDK provides defaults for: exporterUrl, apiKey, sampleRate (0.1 = 10%)
      },
      verificationSettings: {
        enabled: false, // Disabled as per requirements
      },
    };
  }, [config.telemetryEnabled, config.routingStrategy, config.preferredGateway]);

  // Only remount WayfinderProvider when routing config actually changes, not on every state change
  const routingKey = `${config.routingStrategy}-${config.preferredGateway || 'none'}`;

  return (
    <WayfinderProvider key={routingKey} {...wayfinderConfig}>
      {children}
    </WayfinderProvider>
  );
}

function AppContent() {
  const [searchInput, setSearchInput] = useState('');
  const [isSearched, setIsSearched] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [shouldAutoOpenInNewTab, setShouldAutoOpenInNewTab] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchCounter, setSearchCounter] = useState(0);

  // On mount, check URL for search query and auto-execute
  useEffect(() => {
    // Initialize from URL query parameter - this is the correct pattern for URL-based initialization
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q');
    if (query && query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchInput(query.trim());
      setIsSearched(true);
    }

    // Handle browser back/forward buttons
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const query = params.get('q');
      if (query && query.trim()) {
        setSearchInput(query.trim());
        setIsSearched(true);
      } else {
        setSearchInput('');
        setIsSearched(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSearch = useCallback((input: string) => {
    setSearchInput(input);
    setIsSearched(true);
    setIsCollapsed(false); // Expand when doing a new search
    setShouldAutoOpenInNewTab(false); // Reset flag
    setSearchCounter((prev) => prev + 1); // Increment to force re-fetch with new gateway

    // Update URL with search query
    const url = new URL(window.location.href);
    url.searchParams.set('q', input);
    window.history.pushState({}, '', url.toString());
  }, []);

  const handleRetry = useCallback(() => {
    // Force re-fetch with a different gateway by incrementing counter
    setSearchCounter((prev) => prev + 1);
  }, []);

  const handleOpenInNewTab = useCallback(() => {
    if (resolvedUrl) {
      window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
    }
  }, [resolvedUrl]);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const handleUrlResolved = useCallback((url: string | null) => {
    setResolvedUrl(url);
  }, []);

  const handleSearchAndOpenInNewTab = useCallback((input: string) => {
    setSearchInput(input);
    setIsSearched(true);
    setIsCollapsed(false);
    setShouldAutoOpenInNewTab(true); // Set flag to auto-open
    setSearchCounter((prev) => prev + 1); // Increment to force re-fetch with new gateway

    // Update URL with search query
    const url = new URL(window.location.href);
    url.searchParams.set('q', input);
    window.history.pushState({}, '', url.toString());
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  // Auto-open in new tab when URL resolves and flag is set
  useEffect(() => {
    if (shouldAutoOpenInNewTab && resolvedUrl) {
      window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
      // Reset flag after opening - this is intentional side effect management
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShouldAutoOpenInNewTab(false);
    }
  }, [shouldAutoOpenInNewTab, resolvedUrl]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <SearchBar
        onSearch={handleSearch}
        onSearchAndOpenInNewTab={handleSearchAndOpenInNewTab}
        isSearched={isSearched}
        currentInput={searchInput}
        isCollapsed={isCollapsed}
        onToggleCollapse={handleToggleCollapse}
        onOpenInNewTab={handleOpenInNewTab}
        onOpenSettings={handleOpenSettings}
        hasResolvedUrl={!!resolvedUrl}
        resolvedUrl={resolvedUrl}
      />

      {isSearched && searchInput && (
        <div className="flex-1 overflow-hidden" key="content-viewer-container">
          <ContentViewer
            key={`${searchInput}-${searchCounter}`}
            input={searchInput}
            onRetry={handleRetry}
            onUrlResolved={handleUrlResolved}
          />
        </div>
      )}

      <SettingsFlyout isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <WayfinderConfigProvider>
      <WayfinderWrapper>
        <AppContent />
      </WayfinderWrapper>
    </WayfinderConfigProvider>
  );
}
