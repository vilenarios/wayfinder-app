import { useState, useEffect, useRef } from 'react';

export type VerificationState =
  | 'idle'           // No verification in progress
  | 'verifying'      // Verification in progress
  | 'verified'       // All resources verified successfully
  | 'failed'         // At least one resource failed verification
  | 'partial';       // Some verified, some still pending

export interface VerificationStats {
  total: number;
  verified: number;
  failed: number;
  currentResource?: string;
}

interface VerificationBadgeProps {
  state: VerificationState;
  stats: VerificationStats;
  strictMode: boolean;
  onDetailsClick?: () => void;
}

export function VerificationBadge({
  state,
  stats,
  strictMode,
  onDetailsClick
}: VerificationBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded]);

  if (state === 'idle') return null;

  const getStateConfig = () => {
    switch (state) {
      case 'verifying':
        return {
          icon: (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ),
          bgColor: 'bg-blue',
          textColor: 'text-white',
          label: 'Verifying...',
          description: `Checking ${stats.total} resource${stats.total !== 1 ? 's' : ''}`,
        };
      case 'verified':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          ),
          bgColor: 'bg-semantic-success',
          textColor: 'text-container-L0',
          label: 'Verified',
          description: `${stats.verified} resource${stats.verified !== 1 ? 's' : ''} verified`,
        };
      case 'failed':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          bgColor: 'bg-semantic-error',
          textColor: 'text-white',
          label: 'Verification Failed',
          description: `${stats.failed} of ${stats.total} failed`,
        };
      case 'partial':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          bgColor: 'bg-semantic-warning',
          textColor: 'text-container-L0',
          label: 'Partial Verification',
          description: `${stats.verified} verified, ${stats.failed} failed`,
        };
      default:
        return null;
    }
  };

  const config = getStateConfig();
  if (!config) return null;

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      {/* Main Badge - compact on mobile, full on desktop */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-1.5 md:gap-2 p-1.5 md:px-3 md:py-1.5 rounded-lg ${config.bgColor} ${config.textColor} text-xs md:text-sm font-medium hover:opacity-90 transition-opacity border border-white border-opacity-20`}
        title={config.description}
      >
        {config.icon}
        <span className="hidden md:inline">{config.label}</span>
        {strictMode && state === 'failed' && (
          <span className="hidden md:inline ml-1 px-1.5 py-0.5 bg-white bg-opacity-20 rounded text-xs">
            BLOCKED
          </span>
        )}
        <svg
          className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-container-L2 border border-stroke-high rounded-lg shadow-lg p-4 z-50">
          <div className="text-sm text-text-high mb-3">
            <div className="font-semibold mb-2">Verification Details</div>

            {/* Stats */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-text-low">Total Resources:</span>
                <span className="font-mono">{stats.total}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-low">Verified:</span>
                <span className="font-mono text-semantic-success">{stats.verified}</span>
              </div>
              {stats.failed > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-text-low">Failed:</span>
                  <span className="font-mono text-semantic-error">{stats.failed}</span>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            {stats.total > 0 && (
              <div className="mt-3">
                <div className="w-full bg-container-L3 rounded-full h-2 overflow-hidden">
                  <div className="h-full flex">
                    <div
                      className="bg-semantic-success transition-all duration-300"
                      style={{ width: `${(stats.verified / stats.total) * 100}%` }}
                    />
                    <div
                      className="bg-semantic-error transition-all duration-300"
                      style={{ width: `${(stats.failed / stats.total) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Current Resource (if verifying) */}
            {state === 'verifying' && stats.currentResource && (
              <div className="mt-3 pt-3 border-t border-stroke-low">
                <div className="text-xs text-text-low">Currently verifying:</div>
                <div className="text-xs font-mono text-text-high truncate mt-1">
                  {stats.currentResource}
                </div>
              </div>
            )}

            {/* Strict Mode Warning */}
            {strictMode && state === 'failed' && (
              <div className="mt-3 pt-3 border-t border-stroke-low">
                <div className="text-xs text-semantic-error">
                  Content blocked due to strict mode. Verification must pass to view content.
                </div>
              </div>
            )}

            {/* Non-Strict Mode Warning */}
            {!strictMode && state === 'failed' && (
              <div className="mt-3 pt-3 border-t border-stroke-low">
                <div className="text-xs text-semantic-warning">
                  Content displayed despite verification failure. Enable strict mode in settings for maximum security.
                </div>
              </div>
            )}
          </div>

          {onDetailsClick && (
            <button
              onClick={onDetailsClick}
              className="w-full mt-2 px-3 py-1.5 text-xs text-accent-teal-primary hover:text-accent-teal-secondary border border-stroke-low rounded hover:bg-container-L3 transition-colors"
            >
              View Full Report
            </button>
          )}
        </div>
      )}
    </div>
  );
}
