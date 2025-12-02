import { useEffect, useState } from 'react';

// Thresholds for timeout states
const SLOW_THRESHOLD_MS = 10000;  // 10s - show warning
const TIMEOUT_THRESHOLD_MS = 15000;  // 15s - show retry button

export interface RoutingLoadingScreenProps {
  identifier: string;
  inputType: 'arnsName' | 'txId';
  routingStrategy: string;
  preferredGateway?: string;
  startTime: number;
  onRetry?: () => void;
}

export function RoutingLoadingScreen({
  identifier,
  inputType,
  routingStrategy,
  preferredGateway,
  startTime,
  onRetry,
}: RoutingLoadingScreenProps) {
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed time every 100ms
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [startTime]);

  const formatElapsed = (ms: number): string => {
    const seconds = ms / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(0);
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getStrategyLabel = (): string => {
    switch (routingStrategy) {
      case 'fastest':
        return 'Using fastest gateway';
      case 'random':
        return 'Using random gateway';
      case 'roundRobin':
        return 'Using balanced routing';
      case 'preferred':
        if (preferredGateway) {
          try {
            const hostname = new URL(preferredGateway).hostname;
            return `Using ${hostname}`;
          } catch {
            return 'Using preferred gateway';
          }
        }
        return 'Using preferred gateway';
      default:
        return 'Routing to gateway';
    }
  };

  const isSlow = elapsed >= SLOW_THRESHOLD_MS;
  const isTimeout = elapsed >= TIMEOUT_THRESHOLD_MS;

  return (
    <div className="w-full h-full flex items-center justify-center bg-container-L1">
      <div className="max-w-md w-full mx-4 text-center">
        {/* Animated Globe Icon */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <svg
              className={`w-16 h-16 ${isTimeout ? 'text-semantic-warning' : 'text-accent-teal-primary'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
              />
            </svg>
            {/* Pulsing ring effect - only when not timed out */}
            {!isTimeout && (
              <div className="absolute inset-0 rounded-full border-2 border-accent-teal-primary opacity-30 animate-ping" />
            )}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-lg font-semibold text-text-high mb-2">
          {inputType === 'arnsName' ? 'Resolving ArNS Name' : 'Connecting to Arweave'}
        </h2>

        {/* Identifier */}
        <div className="mb-6">
          <div className="inline-block bg-container-L2 border border-stroke-low rounded-lg px-4 py-2 max-w-full">
            <span className="font-mono text-text-high break-all">{identifier}</span>
          </div>
        </div>

        {/* Routing Strategy */}
        <p className="text-sm text-text-low mb-4">{getStrategyLabel()}</p>

        {/* Warning/Timeout States */}
        {isSlow && !isTimeout && (
          <div className="mb-4 flex items-center justify-center gap-2 text-semantic-warning">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-sm">Taking longer than usual...</span>
          </div>
        )}

        {isTimeout && (
          <div className="mb-4">
            <div className="flex items-center justify-center gap-2 text-semantic-warning mb-3">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span className="text-sm">Gateway may be unresponsive</span>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-4 py-2 bg-accent-teal-primary text-container-L0 rounded-lg hover:bg-accent-teal-secondary transition-colors text-sm font-medium"
              >
                Try different gateway
              </button>
            )}
          </div>
        )}

        {/* Elapsed Time */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-text-low">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{formatElapsed(elapsed)}</span>
        </div>
      </div>
    </div>
  );
}
