import { useEffect, useMemo, memo } from 'react';
import { useWayfinderUrl } from '@ar.io/wayfinder-react';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorDisplay } from './ErrorDisplay';
import { detectInputType } from '../utils/detectInputType';

interface ContentViewerProps {
  input: string;
  onRetry: () => void;
  onUrlResolved: (url: string | null) => void;
}

export const ContentViewer = memo(function ContentViewer({ input, onRetry, onUrlResolved }: ContentViewerProps) {
  const inputType = detectInputType(input);

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

  if (isLoading) {
    return (
      <LoadingSpinner
        message={
          inputType === 'arnsName'
            ? `Resolving ArNS name "${input}"...`
            : 'Loading content from Arweave...'
        }
      />
    );
  }

  if (error) {
    return <ErrorDisplay error={error} onRetry={onRetry} />;
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
