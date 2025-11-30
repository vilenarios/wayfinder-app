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
import {
  VerificationBadge,
  type VerificationState,
  type VerificationStats,
} from './components/VerificationBadge';
import { VerificationBlockedModal } from './components/VerificationBlockedModal';
import { swMessenger } from './utils/serviceWorkerMessaging';
import { getTrustedGateways, getRoutingGateways } from './utils/trustedGateways';
import type { VerificationEvent } from './service-worker/types';

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

      // If hostname starts with "wayfinder" subdomain, strip it to get the gateway
      // This handles any number of domain parts (2, 3, 4, 5, etc.)
      if (parts[0] === 'wayfinder' && parts.length > 1) {
        // wayfinder.ar-io.dev → ar-io.dev
        // wayfinder.vilenarios.com → vilenarios.com
        // wayfinder.some.gateway.com → some.gateway.com
        const gateway = parts.slice(1).join('.');
        return new URL(`https://${gateway}`);
      }

      // Otherwise, the hostname IS the gateway (works for 2, 3, 4+ parts)
      // ar-io.dev → ar-io.dev
      // some.gateway.com → some.gateway.com
      // my.multi.part.gateway.com → my.multi.part.gateway.com
      return new URL(`https://${hostname}`);
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
  const { config } = useWayfinderConfig();
  const [searchInput, setSearchInput] = useState('');
  const [isSearched, setIsSearched] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [shouldAutoOpenInNewTab, setShouldAutoOpenInNewTab] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchCounter, setSearchCounter] = useState(0);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [swReady, setSwReady] = useState(false);

  // Verification state tracking
  const [verificationState, setVerificationState] = useState<VerificationState>('idle');
  const [verificationStats, setVerificationStats] = useState<VerificationStats>({
    total: 0,
    verified: 0,
    failed: 0,
  });
  const [verificationError, setVerificationError] = useState<string | undefined>();
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [userBypassedVerification, setUserBypassedVerification] = useState(false);

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

  // Register and initialize service worker for verification
  useEffect(() => {
    async function initServiceWorker() {
      if (!config.verificationEnabled) {
        console.log('Verification disabled, skipping service worker');
        setSwReady(false);
        return;
      }

      try {
        // Register service worker
        // Dev: vite-plugin-pwa serves at /dev-sw.js?dev-sw as ES module
        // Prod: vite-plugin-pwa outputs to /service-worker.js as IIFE (no module type needed)
        await swMessenger.register(
          import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/service-worker.js',
          import.meta.env.DEV ? { type: 'module' } : undefined
        );

        // Check if we have a controller
        // On first registration, the SW won't control the page until reload
        // The SettingsFlyout auto-reloads when verification is first enabled
        // For edge cases (e.g., cleared SW), we just log and continue - it will work on next reload
        if (!navigator.serviceWorker.controller) {
          console.log('Service worker registered but not yet controlling page - will be active after reload');
          setSwReady(false);
          return;
        }

        // Get trusted gateways (top-staked, for hash verification)
        const trustedGateways = await getTrustedGateways();

        // Get routing gateways (broader pool, for content fetching)
        const routingGateways = await getRoutingGateways();

        // Initialize Wayfinder in service worker
        await swMessenger.initializeWayfinder({
          trustedGateways: trustedGateways.map(u => u.toString()),
          routingGateways: routingGateways.map(u => u.toString()),
          routingStrategy: config.routingStrategy,
          preferredGateway: config.preferredGateway,
          enabled: true,
          strict: config.strictVerification,
        });

        setSwReady(true);
        console.log('Service worker ready for verification');

      } catch (error) {
        console.error('Failed to initialize service worker:', error);
        setSwReady(false);
      }
    }

    initServiceWorker();
  }, [config.verificationEnabled, config.routingStrategy, config.preferredGateway, config.strictVerification]);

  // Listen for service worker messages (routing gateway, verification events)
  useEffect(() => {
    if (!config.verificationEnabled) return;

    const handleSwMessage = (event: MessageEvent) => {
      const { type, event: verificationEvent } = event.data;
      if (type === 'VERIFICATION_EVENT' && verificationEvent) {
        const vEvent = verificationEvent as VerificationEvent;

        // Handle routing gateway event - update the resolved URL display
        if (vEvent.type === 'routing-gateway' && vEvent.gatewayUrl) {
          console.log('Routing via gateway:', vEvent.gatewayUrl);
          // For ArNS names, show the subdomain format (e.g., vilenarios.saveario.site)
          // For txIds (43 chars), show the path format (e.g., saveario.site/{txId})
          const isTxId = /^[A-Za-z0-9_-]{43}$/.test(vEvent.identifier);
          const gatewayHost = new URL(vEvent.gatewayUrl).host;
          const fullUrl = isTxId
            ? `${vEvent.gatewayUrl}/${vEvent.identifier}`
            : `https://${vEvent.identifier}.${gatewayHost}`;
          setResolvedUrl(fullUrl);
        }

        // Handle verification-started
        if (vEvent.type === 'verification-started') {
          setVerificationState('verifying');
          setVerificationStats({
            total: vEvent.progress?.total || 1,
            verified: 0,
            failed: 0,
          });
          setVerificationError(undefined);
          setShowBlockedModal(false);
          setUserBypassedVerification(false);
        }

        // Handle verification-progress
        if (vEvent.type === 'verification-progress' && vEvent.progress) {
          setVerificationStats(prev => ({
            ...prev,
            total: vEvent.progress!.total,
            verified: vEvent.progress!.current,
            currentResource: vEvent.resourcePath,
          }));
        }

        // Handle manifest-loaded - we now know total resources
        if (vEvent.type === 'manifest-loaded' && vEvent.progress) {
          setVerificationStats(prev => ({
            ...prev,
            total: vEvent.progress!.total,
          }));
        }

        // Handle verification-complete
        if (vEvent.type === 'verification-complete') {
          setVerificationState('verified');
          if (vEvent.progress) {
            setVerificationStats(prev => ({
              ...prev,
              total: vEvent.progress!.total,
              verified: vEvent.progress!.current,
            }));
          }
        }

        // Handle verification-failed
        if (vEvent.type === 'verification-failed') {
          setVerificationStats(prev => ({
            ...prev,
            failed: prev.failed + 1,
          }));
          setVerificationError(vEvent.error);

          // Determine if this is a total failure or partial
          // Use the progress from the event, not stale closure state
          const verifiedCount = vEvent.progress?.current ?? 0;
          setVerificationState(verifiedCount > 0 ? 'partial' : 'failed');

          // Show blocked modal if strict mode is enabled and user hasn't bypassed
          if (config.strictVerification && !userBypassedVerification) {
            setShowBlockedModal(true);
          }
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSwMessage);
  }, [config.verificationEnabled, config.strictVerification, userBypassedVerification]);

  const handleSearch = useCallback((input: string) => {
    setSearchInput(input);
    setIsSearched(true);
    setIsCollapsed(false); // Expand when doing a new search
    setShouldAutoOpenInNewTab(false); // Reset flag
    setRetryAttempts(0); // Reset retry attempts for new search
    setSearchCounter((prev) => prev + 1); // Increment to force re-fetch with new gateway

    // Reset verification state for new search
    setVerificationState('idle');
    setVerificationStats({ total: 0, verified: 0, failed: 0 });
    setVerificationError(undefined);
    setShowBlockedModal(false);
    setUserBypassedVerification(false);

    // Update URL with search query
    const url = new URL(window.location.href);
    url.searchParams.set('q', input);
    window.history.pushState({}, '', url.toString());
  }, []);

  const handleRetry = useCallback(async () => {
    // Increment retry attempts
    const newAttempts = retryAttempts + 1;
    setRetryAttempts(newAttempts);

    // Reset verification state for retry
    setVerificationState('idle');
    setVerificationStats({ total: 0, verified: 0, failed: 0 });
    setVerificationError(undefined);
    setShowBlockedModal(false);
    setUserBypassedVerification(false);

    // Clear verification state in service worker so it re-verifies fresh
    // This is important because isVerificationComplete() returns true for 'partial' status
    if (config.verificationEnabled && searchInput) {
      try {
        await swMessenger.clearVerification(searchInput);
      } catch (error) {
        console.warn('Failed to clear verification state:', error);
      }
    }

    // Every retry forces fresh gateway selection by incrementing gatewayRefreshCounter
    // This busts the cache and gets a new random set of gateways
    setGatewayRefreshCounter((prev) => prev + 1);
    setSearchCounter((prev) => prev + 1);
  }, [retryAttempts, setGatewayRefreshCounter, config.verificationEnabled, searchInput]);

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

  // Modal action handlers for verification blocked modal
  const handleGoBack = useCallback(() => {
    // Clear the search and go back to the home state
    setSearchInput('');
    setIsSearched(false);
    setShowBlockedModal(false);
    setVerificationState('idle');
    setVerificationStats({ total: 0, verified: 0, failed: 0 });
    setVerificationError(undefined);
    setUserBypassedVerification(false);

    // Update URL to remove query param
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.pushState({}, '', url.toString());
  }, []);

  const handleProceedAnyway = useCallback(() => {
    // User has acknowledged the risk and wants to proceed
    setUserBypassedVerification(true);
    setShowBlockedModal(false);
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

  // Determine if content should be blocked (strict mode + verification failed + user hasn't bypassed)
  const shouldBlockContent = config.verificationEnabled &&
    config.strictVerification &&
    (verificationState === 'failed' || verificationState === 'partial') &&
    !userBypassedVerification;

  // Create the verification badge element if needed
  const verificationBadgeElement = config.verificationEnabled &&
    isSearched &&
    searchInput &&
    verificationState !== 'idle' ? (
      <VerificationBadge
        state={verificationState}
        stats={verificationStats}
        strictMode={config.strictVerification}
      />
    ) : undefined;

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
        verificationBadge={verificationBadgeElement}
      />

      {isSearched && searchInput && (
        <div className="flex-1 overflow-hidden relative" key="content-viewer-container">
          {config.verificationEnabled && swReady ? (
            <>
              {/* Show iframe unless content is blocked */}
              {!shouldBlockContent && (
                <iframe
                  key={`${searchInput}-${searchCounter}`}
                  src={`/ar-proxy/${searchInput}/`}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  title={`Verified content for ${searchInput}`}
                />
              )}

              {/* Show blocked placeholder when content is blocked */}
              {shouldBlockContent && (
                <div className="w-full h-full flex items-center justify-center bg-container-L1">
                  <div className="text-center p-8">
                    <div className="text-6xl mb-4">🛡️</div>
                    <div className="text-xl font-semibold text-text-high mb-2">
                      Content Blocked
                    </div>
                    <div className="text-text-low max-w-md">
                      Verification failed and strict mode is enabled.
                      Use the dialog to retry, go back, or proceed at your own risk.
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            // Direct gateway URL (no verification)
            <ContentViewer
              key={`${searchInput}-${searchCounter}`}
              input={searchInput}
              onRetry={handleRetry}
              onUrlResolved={handleUrlResolved}
              retryAttempts={retryAttempts}
            />
          )}
        </div>
      )}

      {/* Verification Blocked Modal */}
      {showBlockedModal && (
        <VerificationBlockedModal
          identifier={searchInput}
          errorMessage={verificationError}
          failedCount={verificationStats.failed}
          totalCount={verificationStats.total}
          onGoBack={handleGoBack}
          onRetry={handleRetry}
          onProceedAnyway={handleProceedAnyway}
        />
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
