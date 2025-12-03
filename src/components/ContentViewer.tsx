import { useEffect, useMemo, useState, memo, useRef } from 'react';
import { useWayfinderUrl } from '@ar.io/wayfinder-react';
import { RoutingLoadingScreen } from './RoutingLoadingScreen';
import { ErrorDisplay } from './ErrorDisplay';
import { detectInputType } from '../utils/detectInputType';
import { useWayfinderConfig } from '../context/WayfinderConfigContext';
import { checkGatewayHealth } from '../utils/gatewayHealthCheck';
import { MAX_GATEWAY_AUTO_RETRIES } from '../utils/constants';

interface ContentViewerProps {
  input: string;
  onRetry: () => void;
  onUrlResolved: (url: string | null) => void;
  retryAttempts?: number;
}

export const ContentViewer = memo(function ContentViewer({ input, onRetry, onUrlResolved, retryAttempts = 0 }: ContentViewerProps) {
  const inputType = detectInputType(input);
  const hasAutoRetried = useRef(false);
  const { config } = useWayfinderConfig();

  // Track when this component mounted (for elapsed time display)
  // Since component is keyed by `${searchInput}-${searchCounter}`, it remounts on each search
  // useState lazy initializer ensures this only runs once on mount
  const [mountTime] = useState(() => Date.now());

  // Health check result - only set when check completes (passed or skipped after max retries)
  const [healthCheckPassed, setHealthCheckPassed] = useState(false);
  // Track if health check has been initiated (use ref to avoid triggering re-renders)
  const healthCheckStarted = useRef(false);

  // Memoize params to prevent unnecessary re-resolutions
  const params = useMemo(
    () => (inputType === 'txId' ? { txId: input } : { arnsName: input }),
    [inputType, input]
  );

  const { resolvedUrl, isLoading, error } = useWayfinderUrl(params);

  // Pre-flight health check when URL is resolved
  useEffect(() => {
    // Only run health check once per resolved URL
    if (!resolvedUrl || isLoading || healthCheckStarted.current) {
      return;
    }

    healthCheckStarted.current = true;

    checkGatewayHealth(resolvedUrl).then((result) => {
      if (result.healthy) {
        console.log(`[ContentViewer] Gateway healthy (${result.latencyMs}ms)`);
        setHealthCheckPassed(true);
      } else {
        console.log(`[ContentViewer] Gateway unhealthy: ${result.error}`);
        // Auto-retry if we haven't exceeded max retries
        if (retryAttempts < MAX_GATEWAY_AUTO_RETRIES) {
          console.log(`[ContentViewer] Health check failed, retrying with different gateway (attempt ${retryAttempts + 1}/${MAX_GATEWAY_AUTO_RETRIES})`);
          onRetry();
        } else {
          // Show the content anyway after max retries - let user decide
          setHealthCheckPassed(true);
        }
      }
    });
  }, [resolvedUrl, isLoading, retryAttempts, onRetry]);

  // Notify parent when URL is resolved AND health check passed
  useEffect(() => {
    if (healthCheckPassed && resolvedUrl) {
      onUrlResolved(resolvedUrl);
    } else if (!resolvedUrl) {
      onUrlResolved(null);
    }
  }, [resolvedUrl, healthCheckPassed, onUrlResolved]);

  // Derived state: checking health if URL resolved but check hasn't passed yet
  // (We're in health check phase once URL resolves and until healthCheckPassed becomes true)
  const isCheckingHealth = !!resolvedUrl && !isLoading && !healthCheckPassed;

  // Auto-retry logic for useWayfinderUrl errors
  useEffect(() => {
    if (error && !isLoading && retryAttempts < MAX_GATEWAY_AUTO_RETRIES && !hasAutoRetried.current) {
      // Check if it's a gateway failure error (not a 404 or other content error)
      const isGatewayError =
        error.message.toLowerCase().includes('gateway') ||
        error.message.toLowerCase().includes('network') ||
        error.message.toLowerCase().includes('failed to fetch') ||
        error.message.toLowerCase().includes('timeout');

      if (isGatewayError) {
        hasAutoRetried.current = true;
        // Wait a brief moment before retrying to avoid hammering
        const timeoutId = setTimeout(() => {
          console.log(`Auto-retrying with fresh gateways (attempt ${retryAttempts + 1}/${MAX_GATEWAY_AUTO_RETRIES})...`);
          onRetry();
        }, 500);

        return () => clearTimeout(timeoutId);
      }
    }

    // Reset auto-retry flag when input changes
    if (!error) {
      hasAutoRetried.current = false;
    }
  }, [error, isLoading, retryAttempts, onRetry]);

  // Show loading screen during resolution or health check
  if (isLoading || isCheckingHealth) {
    return (
      <RoutingLoadingScreen
        identifier={input}
        inputType={inputType}
        routingStrategy={config.routingStrategy}
        preferredGateway={config.preferredGateway}
        startTime={mountTime}
        onRetry={onRetry}
        isCheckingHealth={isCheckingHealth}
        retryCount={retryAttempts}
        maxRetries={MAX_GATEWAY_AUTO_RETRIES}
      />
    );
  }

  if (error) {
    const showRetryButton = retryAttempts >= MAX_GATEWAY_AUTO_RETRIES;
    const isAutoRetrying = retryAttempts < MAX_GATEWAY_AUTO_RETRIES;

    return (
      <ErrorDisplay
        error={error}
        onRetry={showRetryButton ? onRetry : undefined}
        isAutoRetrying={isAutoRetrying}
        retryAttempt={retryAttempts}
        maxRetries={MAX_GATEWAY_AUTO_RETRIES}
      />
    );
  }

  // Wait for health check to pass before showing content
  if (!resolvedUrl || !healthCheckPassed) {
    return (
      <div className="flex items-center justify-center h-full text-text-low bg-container-L1">
        No content available
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-container-L1">
      <iframe
        src={resolvedUrl}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        title={`Content for ${input}`}
      />
    </div>
  );
});
