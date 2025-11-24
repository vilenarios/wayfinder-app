import { useEffect, useState } from 'react';
import type { VerificationEvent } from '../service-worker/types';

interface VerificationStatusProps {
  onVerificationEvent?: (event: VerificationEvent) => void;
}

export function VerificationStatus({ onVerificationEvent }: VerificationStatusProps) {
  const [currentVerification, setCurrentVerification] = useState<{
    txId: string;
    status: 'started' | 'progress' | 'success' | 'failed';
    progress?: { current: number; total: number };
    error?: string;
  } | null>(null);

  useEffect(() => {
    // Listen for verification events from service worker
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'VERIFICATION_EVENT') {
        const verificationEvent: VerificationEvent = event.data.event;

        // Update local state
        if (verificationEvent.type === 'verification-started') {
          setCurrentVerification({
            txId: verificationEvent.txId,
            status: 'started',
            progress: verificationEvent.progress,
          });
        } else if (verificationEvent.type === 'verification-progress') {
          setCurrentVerification(prev => prev ? {
            ...prev,
            status: 'progress',
            progress: verificationEvent.progress,
          } : null);
        } else if (verificationEvent.type === 'verification-success') {
          setCurrentVerification({
            txId: verificationEvent.txId,
            status: 'success',
            progress: verificationEvent.progress,
          });
          // Auto-hide after 3 seconds
          setTimeout(() => setCurrentVerification(null), 3000);
        } else if (verificationEvent.type === 'verification-failed') {
          setCurrentVerification({
            txId: verificationEvent.txId,
            status: 'failed',
            error: verificationEvent.error,
          });
          // Keep visible longer for failures
          setTimeout(() => setCurrentVerification(null), 5000);
        }

        // Notify parent
        onVerificationEvent?.(verificationEvent);
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, [onVerificationEvent]);

  if (!currentVerification) return null;

  const { status, progress, error } = currentVerification;

  const statusConfig = {
    started: {
      icon: '⏳',
      text: 'Starting verification...',
      color: 'bg-blue text-white',
    },
    progress: {
      icon: '🔍',
      text: progress ? `Verifying... ${progress.current}/${progress.total}` : 'Verifying...',
      color: 'bg-blue text-white',
    },
    success: {
      icon: '✓',
      text: progress ? `Verified ${progress.total} resources` : 'Content verified',
      color: 'bg-semantic-success text-container-L0',
    },
    failed: {
      icon: '⚠️',
      text: error || 'Verification failed',
      color: 'bg-semantic-error text-white',
    },
  };

  const config = statusConfig[status];

  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg ${config.color} flex items-center gap-3 animate-slide-in z-50 min-w-[250px]`}>
      <span className="text-xl">{config.icon}</span>
      <div className="flex-1">
        <p className="text-sm font-medium">{config.text}</p>
        {progress && progress.total > 1 && (
          <div className="mt-1 w-full bg-white bg-opacity-20 rounded-full h-1.5">
            <div
              className="bg-white h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
