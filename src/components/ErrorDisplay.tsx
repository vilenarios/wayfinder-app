import { MAX_GATEWAY_AUTO_RETRIES } from '../utils/constants';

interface ErrorDisplayProps {
  error: Error;
  onRetry?: () => void;
  isAutoRetrying?: boolean;
  retryAttempt?: number;
  maxRetries?: number;
}

export function ErrorDisplay({
  error,
  onRetry,
  isAutoRetrying = false,
  retryAttempt = 0,
  maxRetries = MAX_GATEWAY_AUTO_RETRIES,
}: ErrorDisplayProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-4 md:p-8 max-w-md mx-auto bg-container-L1">
      <div className="text-semantic-error text-4xl md:text-5xl">⚠️</div>
      <h2 className="text-lg md:text-xl font-semibold text-white">
        {isAutoRetrying ? 'Retrying with different gateways...' : 'Something went wrong'}
      </h2>
      <p className="text-text-low text-sm md:text-base text-center px-4">{error.message}</p>
      {isAutoRetrying && (
        <p className="text-text-low text-xs text-center">
          Attempt {retryAttempt + 1}/{maxRetries} - Trying fresh gateways...
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-6 py-2.5 md:px-4 md:py-2 bg-accent-teal-primary text-container-L0 rounded-lg hover:bg-accent-teal-secondary transition-colors font-medium"
        >
          Try Again with Different Gateways
        </button>
      )}
    </div>
  );
}
