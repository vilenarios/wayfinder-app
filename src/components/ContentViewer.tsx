import { useEffect, useMemo, useState, memo, useRef } from 'react';
import { useWayfinderUrl } from '@ar.io/wayfinder-react';
import { RoutingLoadingScreen } from './RoutingLoadingScreen';
import { ErrorDisplay } from './ErrorDisplay';
import { detectInputType } from '../utils/detectInputType';
import { useWayfinderConfig } from '../context/WayfinderConfigContext';

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

  // Memoize params to prevent unnecessary re-resolutions
  const params = useMemo(
    () => (inputType === 'txId' ? { txId: input } : { arnsName: input }),
    [inputType, input]
  );

  const { resolvedUrl, isLoading, error } = useWayfinderUrl(params);

  // Notify parent when URL is resolved
  useEffect(() => {
    onUrlResolved(resolvedUrl || null);
  }, [resolvedUrl, onUrlResolved]);

  // Auto-retry logic: if all gateways fail and we haven't tried enough times yet
  useEffect(() => {
    const MAX_AUTO_RETRIES = 2; // Auto-retry up to 2 times before showing error

    if (error && !isLoading && retryAttempts < MAX_AUTO_RETRIES && !hasAutoRetried.current) {
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
          console.log(`Auto-retrying with fresh gateways (attempt ${retryAttempts + 1}/${MAX_AUTO_RETRIES})...`);
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

  if (isLoading) {
    return (
      <RoutingLoadingScreen
        identifier={input}
        inputType={inputType}
        routingStrategy={config.routingStrategy}
        preferredGateway={config.preferredGateway}
        startTime={mountTime}
        onRetry={onRetry}
      />
    );
  }

  if (error) {
    const MAX_AUTO_RETRIES = 2;
    const showRetryButton = retryAttempts >= MAX_AUTO_RETRIES;
    const isAutoRetrying = retryAttempts < MAX_AUTO_RETRIES;

    return (
      <ErrorDisplay
        error={error}
        onRetry={showRetryButton ? onRetry : undefined}
        isAutoRetrying={isAutoRetrying}
        retryAttempt={retryAttempts}
      />
    );
  }

  if (!resolvedUrl) {
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
