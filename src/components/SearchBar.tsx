import { useState, useRef, useEffect, memo, type FormEvent } from 'react';
import { isValidInput } from '../utils/detectInputType';

interface SearchBarProps {
  onSearch: (input: string) => void;
  isSearched: boolean;
  currentInput: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
  resolvedUrl: string | null;
  /** Optional verification badge to display in the toolbar */
  verificationBadge?: React.ReactNode;
}

export const SearchBar = memo(function SearchBar({
  onSearch,
  isSearched,
  currentInput,
  isCollapsed,
  onToggleCollapse,
  onOpenSettings,
  resolvedUrl,
  verificationBadge,
}: SearchBarProps) {
  const [input, setInput] = useState(currentInput);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInput(currentInput);
  }, [currentInput]);

  useEffect(() => {
    if (!isSearched) {
      inputRef.current?.focus();
    }
  }, [isSearched]);

  const validateInput = () => {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      setError('Please enter an ArNS name or transaction ID');
      return false;
    }

    if (!isValidInput(trimmedInput)) {
      setError('Invalid input. Please enter a valid ArNS name or 43-character transaction ID');
      return false;
    }

    setError('');
    return true;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (validateInput()) {
      onSearch(input.trim());
    }
  };

  const containerClasses = isSearched
    ? 'w-full bg-container-L1 border-b border-stroke-low shadow-sm py-3'
    : 'flex flex-col items-center justify-center min-h-screen bg-container-L0';

  const formClasses = isSearched ? 'max-w-none px-3' : 'max-w-2xl w-full px-4 md:px-6';

  // When collapsed on results page, render minimal floating button
  if (isSearched && isCollapsed) {
    return (
      <div className="absolute top-2 left-3 z-10">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 bg-container-L2 text-icon-mid rounded-lg hover:bg-container-L3 hover:text-icon-high transition-colors border border-stroke-low shadow-md"
          title="Expand search bar"
        >
          <svg
            className="w-4 h-4 transition-transform duration-200"
            style={{ transform: 'rotate(180deg)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 15l7-7 7 7"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {/* Settings button in top right on homepage */}
      {!isSearched && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="absolute top-4 right-4 md:top-6 md:right-6 px-3 py-2 md:px-4 md:py-3 bg-container-L2 text-text-high rounded-lg hover:bg-container-L3 transition-colors font-medium shadow-sm hover:shadow-md border border-stroke-low"
          title="Settings"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      )}

      <form onSubmit={handleSubmit} className={formClasses}>
        {!isSearched && (
          <div className="text-center mb-6 md:mb-8">
            <div className="flex items-center justify-center gap-3 md:gap-4 mb-2 md:mb-3">
              <img
                src="/wayfinder-logo.svg"
                alt="Wayfinder Logo"
                className="w-12 h-12 md:w-16 md:h-16"
              />
              <h1 className="text-4xl md:text-5xl font-bold text-white">Wayfinder</h1>
            </div>
            <p className="text-text-low text-base md:text-lg">
              Decentralized access to Arweave via AR.IO Network
            </p>
          </div>
        )}

        <div className={`flex flex-col gap-2 ${isSearched ? '' : ''}`}>
          {/* Results page: all controls on one row */}
          {isSearched && (
            <div className="flex gap-1.5 items-center">
              {/* Collapse button */}
              <button
                type="button"
                onClick={onToggleCollapse}
                className="p-1.5 bg-container-L2 text-icon-mid rounded-lg hover:bg-container-L3 hover:text-icon-high transition-colors border border-stroke-low flex-shrink-0"
                title="Collapse search bar"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              </button>

              {/* Input field with ar:// prefix and clear button */}
              <div className="relative flex-1 min-w-0">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-low font-mono text-sm pointer-events-none select-none">
                  ar://
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setError('');
                  }}
                  placeholder="ArNS name or tx ID..."
                  className={`w-full pl-14 pr-8 py-2 bg-container-L2 border text-text-high placeholder:text-text-low rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-teal-primary focus:border-transparent font-mono text-base ${
                    error ? 'border-semantic-error' : 'border-stroke-low'
                  }`}
                />
                {/* Clear button - only show when there's input */}
                {input && (
                  <button
                    type="button"
                    onClick={() => {
                      setInput('');
                      setError('');
                      inputRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-low hover:text-text-high transition-colors"
                    title="Clear"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>

              {/* Action buttons */}
              <button
                type="submit"
                className="p-1.5 bg-accent-teal-primary text-container-L0 rounded-lg hover:bg-accent-teal-secondary transition-colors font-medium shadow-sm hover:shadow-md flex items-center justify-center flex-shrink-0"
                title="Explore"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </button>

              <button
                type="button"
                onClick={onOpenSettings}
                className="p-1.5 bg-container-L2 text-text-high rounded-lg hover:bg-container-L3 transition-colors font-medium shadow-sm hover:shadow-md border border-stroke-low flex-shrink-0"
                title="Settings"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* Homepage layout */}
          {!isSearched && (
            <>
              {/* Input field with ar:// prefix - font-size 16px minimum to prevent iOS zoom */}
              <div className="relative w-full">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-low font-mono text-base pointer-events-none select-none">
                  ar://
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setError('');
                  }}
                  placeholder="ArNS name or tx ID..."
                  className={`w-full pl-[4.5rem] pr-3 md:pr-4 py-3 md:py-3 bg-container-L2 border text-text-high placeholder:text-text-low rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-teal-primary focus:border-transparent font-mono text-base ${
                    error ? 'border-semantic-error' : 'border-stroke-low'
                  }`}
                />
                {error && (
                  <p className="absolute left-0 -bottom-6 text-semantic-error text-sm">{error}</p>
                )}
              </div>
            </>
          )}

        </div>

        {/* Gateway URL display - show when URL is resolved */}
        {isSearched && resolvedUrl && (
          <div className="mt-2 px-2 py-2 bg-container-L2 border border-stroke-low rounded-md">
            <div className="flex items-center gap-2 text-xs">
              <svg
                className="w-4 h-4 text-icon-low flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              <span className="text-text-low whitespace-nowrap">Routing via:</span>
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-teal-primary hover:text-accent-teal-secondary font-mono truncate flex-1 min-w-0"
                title={resolvedUrl}
              >
                {resolvedUrl}
              </a>
              {/* Verification Badge */}
              {verificationBadge}
            </div>
          </div>
        )}

        {error && isSearched && (
          <p className="text-semantic-error text-sm mt-2">{error}</p>
        )}

        {!isSearched && (
          <div className="mt-6 md:mt-8 text-center">
            <p className="text-sm text-text-low mb-3">Examples:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                type="button"
                onClick={() => setInput('turbo')}
                className="px-3 py-1.5 bg-container-L2 border border-stroke-low rounded-md text-sm text-text-high hover:bg-container-L3 transition-colors"
              >
                turbo
              </button>
              <button
                type="button"
                onClick={() => setInput('vilenarios')}
                className="px-3 py-1.5 bg-container-L2 border border-stroke-low rounded-md text-sm text-text-high hover:bg-container-L3 transition-colors"
              >
                vilenarios
              </button>
              <button
                type="button"
                onClick={() => setInput('arns')}
                className="px-3 py-1.5 bg-container-L2 border border-stroke-low rounded-md text-sm text-text-high hover:bg-container-L3 transition-colors"
              >
                arns
              </button>
              <button
                type="button"
                onClick={() => setInput('continuum')}
                className="px-3 py-1.5 bg-container-L2 border border-stroke-low rounded-md text-sm text-text-high hover:bg-container-L3 transition-colors"
              >
                continuum
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
});
