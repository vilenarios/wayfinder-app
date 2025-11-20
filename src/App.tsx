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
function WayfinderWrapper({ children, gatewayRefreshCounter }: { children: React.ReactNode; gatewayRefreshCounter: number }) {
  const { config } = useWayfinderConfig();

  // Build Wayfinder configuration based on user settings
  const wayfinderConfig = useMemo(() => {
    // Get the gateway serving this app as ultimate fallback
    const getHostGateway = (): URL | null => {
      if (typeof window === 'undefined') return null;

      const hostname = window.location.hostname;

      // Skip localhost and local development
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('192.168')) {
        return null;
      }

      const parts = hostname.split('.');

      // If accessed via subdomain like wayfinder.vilenarios.com (3+ parts), extract the gateway
      if (parts.length > 2) {
        // Remove the first subdomain part (e.g., "wayfinder") to get the gateway domain
        // wayfinder.ar-io.dev → ar-io.dev
        // wayfinder.vilenarios.com → vilenarios.com
        const gateway = parts.slice(1).join('.');
        return new URL(`https://${gateway}`);
      }

      // If accessed directly via gateway domain (2 parts like ar-io.dev or arweave.net)
      if (parts.length === 2) {
        return new URL(`https://${hostname}`);
      }

      // Single part hostname or invalid - shouldn't happen in production
      return null;
    };

    // Create a resilient gateways provider with multiple fallbacks
    const resilientProvider = {
      async getGateways(): Promise<URL[]> {
        // Build list of peers endpoints to try
        const peersEndpoints: string[] = ['https://arweave.net'];

        // Add the host gateway as backup peers source
        const hostGateway = getHostGateway();
        if (hostGateway) {
          peersEndpoints.push(hostGateway.toString());
        }

        // Try each peers endpoint in sequence
        for (const trustedGateway of peersEndpoints) {
          try {
            const provider = new TrustedPeersGatewaysProvider({ trustedGateway });
            const gateways = await provider.getGateways();
            if (gateways && gateways.length > 0) {
              console.log(`Successfully fetched ${gateways.length} gateways from ${trustedGateway}`);
              return gateways;
            }
          } catch (error) {
            console.warn(`Failed to fetch gateways from ${trustedGateway}:`, error);
          }
        }

        // If all peers endpoints fail, just use the host gateway itself
        if (hostGateway) {
          console.warn('All peers endpoints failed, using host gateway directly:', hostGateway);
          return [hostGateway];
        }

        // Ultimate fallback for local development
        console.warn('No host gateway detected (localhost?), using arweave.net as fallback');
        return [new URL('https://arweave.net')];
      },
    };

    // Wrap with a limiting provider to randomly select 20 gateways
    const limitedProvider = {
      async getGateways() {
        const allGateways = await resilientProvider.getGateways();

        // Shuffle the gateways array using Fisher-Yates algorithm
        const shuffled = [...allGateways];
        for (let i = shuffled.length - 1; i > 0; i--) {
          // eslint-disable-next-line react-hooks/purity
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Return random 20 gateways (or all if fewer than 20)
        return shuffled.slice(0, Math.min(20, shuffled.length));
      },
    };

    const gatewaysProvider = new SimpleCacheGatewaysProvider({
      gatewaysProvider: limitedProvider,
      ttlSeconds: 3 * 60, // 3 minutes cache - allows fresh gateways on retry
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
  }, [config.telemetryEnabled, config.routingStrategy, config.preferredGateway, gatewayRefreshCounter]);

  // Only remount WayfinderProvider when routing config actually changes, not on every state change
  // Include gatewayRefreshCounter to force fresh gateway selection on retry
  const routingKey = `${config.routingStrategy}-${config.preferredGateway || 'none'}-${gatewayRefreshCounter}`;

  return (
    <WayfinderProvider key={routingKey} {...wayfinderConfig}>
      {children}
    </WayfinderProvider>
  );
}

function AppContent({ setGatewayRefreshCounter }: { gatewayRefreshCounter: number; setGatewayRefreshCounter: (fn: (prev: number) => number) => void }) {
  const [searchInput, setSearchInput] = useState('');
  const [isSearched, setIsSearched] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [shouldAutoOpenInNewTab, setShouldAutoOpenInNewTab] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchCounter, setSearchCounter] = useState(0);
  const [retryAttempts, setRetryAttempts] = useState(0);

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
    setRetryAttempts(0); // Reset retry attempts for new search
    setSearchCounter((prev) => prev + 1); // Increment to force re-fetch with new gateway

    // Update URL with search query
    const url = new URL(window.location.href);
    url.searchParams.set('q', input);
    window.history.pushState({}, '', url.toString());
  }, []);

  const handleRetry = useCallback(() => {
    // Increment retry attempts
    const newAttempts = retryAttempts + 1;
    setRetryAttempts(newAttempts);

    // Every retry forces fresh gateway selection by incrementing gatewayRefreshCounter
    // This busts the cache and gets a new random set of gateways
    setGatewayRefreshCounter((prev) => prev + 1);
    setSearchCounter((prev) => prev + 1);
  }, [retryAttempts, setGatewayRefreshCounter]);

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
    setRetryAttempts(0); // Reset retry attempts for new search
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
            retryAttempts={retryAttempts}
          />
        </div>
      )}

      <SettingsFlyout isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

export default function App() {
  const [gatewayRefreshCounter, setGatewayRefreshCounter] = useState(0);

  return (
    <WayfinderConfigProvider>
      <WayfinderWrapper gatewayRefreshCounter={gatewayRefreshCounter}>
        <AppContent
          gatewayRefreshCounter={gatewayRefreshCounter}
          setGatewayRefreshCounter={setGatewayRefreshCounter}
        />
      </WayfinderWrapper>
    </WayfinderConfigProvider>
  );
}
