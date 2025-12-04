import { useState, useEffect } from 'react';
import { useWayfinderConfig } from '../context/WayfinderConfigContext';
import { ROUTING_STRATEGY_OPTIONS } from '../utils/constants';
import { getTrustedGateways } from '../utils/trustedGateways';
import type { WayfinderConfig, VerificationMethod } from '../types';
import packageJson from '../../package.json';

// Feature flag: Signature verification is hidden until SDK fixes ANS-104 data item support
// The SDK's SignatureVerificationStrategy uses /tx/{txId} which only works for L1 transactions
const SHOW_VERIFICATION_METHOD_SELECTOR = false;

interface SettingsFlyoutProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsFlyout({ isOpen, onClose }: SettingsFlyoutProps) {
  const { config, updateConfig } = useWayfinderConfig();
  const [localConfig, setLocalConfig] = useState<WayfinderConfig>(config);
  const [verificationGateways, setVerificationGateways] = useState<string[]>([]);
  const [loadingGateways, setLoadingGateways] = useState(false);

  useEffect(() => {
    // Sync local state with context when settings open or config changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalConfig(config);
  }, [config, isOpen]);

  // Fetch verification gateways when settings panel opens and verification is enabled
  useEffect(() => {
    if (isOpen && (config.verificationEnabled || localConfig.verificationEnabled)) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setLoadingGateways(true);
      getTrustedGateways()
        .then(gateways => {
          setVerificationGateways(gateways.map(u => u.toString()));
        })
        .catch(err => {
          console.error('Failed to fetch verification gateways:', err);
          setVerificationGateways([]);
        })
        .finally(() => {
          setLoadingGateways(false);
        });
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isOpen, config.verificationEnabled, localConfig.verificationEnabled]);

  const handleSave = () => {
    // Trim the preferred gateway URL before saving
    const configToSave = {
      ...localConfig,
      preferredGateway: localConfig.preferredGateway?.trim(),
    };

    updateConfig(configToSave);
    onClose();

    // Note: No reload needed when enabling verification.
    // The service worker is registered proactively at app startup (main.tsx),
    // so it's already controlling the page. The SW will wait for initialization
    // via request queuing if needed.
  };

  const handleCancel = () => {
    setLocalConfig(config);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-70 z-40 transition-opacity"
        onClick={handleCancel}
      />

      {/* Flyout Panel */}
      <div className="fixed right-0 top-0 h-full w-full sm:max-w-md bg-container-L1 shadow-2xl z-50 overflow-y-auto">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-stroke-low">
            <h2 className="text-2xl font-bold text-white">Settings</h2>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-container-L2 rounded-lg transition-colors"
              aria-label="Close settings"
            >
              <svg
                className="w-6 h-6 text-icon-high"
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
          </div>

          {/* Content */}
          <div className="flex-1 p-4 space-y-4">
            {/* Routing Strategy */}
            <div className="border border-stroke-high rounded-lg p-3 bg-container-L2">
              <div className="font-medium text-text-high mb-3">Gateway Routing</div>
              <div className="space-y-2">
                {ROUTING_STRATEGY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-3 p-2 border border-stroke-low rounded-lg cursor-pointer hover:bg-container-L3 transition-colors"
                  >
                    <input
                      type="radio"
                      name="routingStrategy"
                      value={option.value}
                      checked={localConfig.routingStrategy === option.value}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          routingStrategy: e.target.value as WayfinderConfig['routingStrategy'],
                        })
                      }
                      className="mt-1 w-4 h-4 text-accent-teal-primary focus:ring-accent-teal-primary accent-accent-teal-primary"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-text-high">{option.label}</div>
                      <div className="text-sm text-text-low mt-1">{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Preferred Gateway (conditional) */}
              {localConfig.routingStrategy === 'preferred' && (
                <div className="mt-3 pt-3 border-t border-stroke-low">
                  <label className="block text-sm font-medium text-text-high mb-2">
                    Preferred Gateway URL
                  </label>
                  <input
                    type="text"
                    value={localConfig.preferredGateway || ''}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        preferredGateway: e.target.value,
                      })
                    }
                    placeholder="https://arweave.net"
                    className="w-full px-3 py-2 bg-container-L3 border border-stroke-low text-text-high placeholder:text-text-low rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-teal-primary focus:border-transparent text-sm"
                  />
                  <p className="text-xs text-text-low mt-2">
                    This gateway will always be used for all requests.
                  </p>
                </div>
              )}
            </div>

            {/* Data Verification */}
            <div className="border border-stroke-high rounded-lg p-3 bg-container-L2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.verificationEnabled}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      verificationEnabled: e.target.checked,
                    })
                  }
                  className="mt-1 w-4 h-4 text-accent-teal-primary rounded focus:ring-accent-teal-primary accent-accent-teal-primary"
                />
                <div className="flex-1">
                  <div className="font-medium text-text-high">Enable Data Verification 🔒</div>
                  <div className="text-sm text-text-low mt-1">
                    Cryptographically verifies ALL content using top-staked AR.IO gateways.
                    This ensures data integrity and protects against tampered content.
                  </div>
                  <div className="mt-2 text-xs text-semantic-warning">
                    ⚠️ Performance Impact: Apps with many resources may take longer to load during verification.
                  </div>
                </div>
              </label>

              {/* Verification Method - controlled by SHOW_VERIFICATION_METHOD_SELECTOR feature flag */}
              {SHOW_VERIFICATION_METHOD_SELECTOR && localConfig.verificationEnabled && (
                <div className="mt-3 pt-3 border-t border-stroke-low">
                  <div className="text-sm font-medium text-text-high mb-2">
                    Verification Method
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 p-2 border border-stroke-low rounded-lg cursor-pointer hover:bg-container-L3 transition-colors">
                      <input
                        type="radio"
                        name="verificationMethod"
                        value="hash"
                        checked={localConfig.verificationMethod === 'hash'}
                        onChange={(e) =>
                          setLocalConfig({
                            ...localConfig,
                            verificationMethod: e.target.value as VerificationMethod,
                          })
                        }
                        className="mt-1 w-4 h-4 text-accent-teal-primary focus:ring-accent-teal-primary accent-accent-teal-primary"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-text-high">Hash Verification</div>
                        <div className="text-xs text-text-low mt-1">
                          Fast SHA-256 hash comparison. Verifies content matches what trusted gateways report.
                        </div>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 p-2 border border-stroke-low rounded-lg cursor-pointer hover:bg-container-L3 transition-colors">
                      <input
                        type="radio"
                        name="verificationMethod"
                        value="signature"
                        checked={localConfig.verificationMethod === 'signature'}
                        onChange={(e) =>
                          setLocalConfig({
                            ...localConfig,
                            verificationMethod: e.target.value as VerificationMethod,
                          })
                        }
                        className="mt-1 w-4 h-4 text-accent-teal-primary focus:ring-accent-teal-primary accent-accent-teal-primary"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-text-high">
                          Signature Verification
                          <span className="ml-2 px-1.5 py-0.5 text-xs bg-semantic-success bg-opacity-20 text-black rounded">
                            Most Secure
                          </span>
                        </div>
                        <div className="text-xs text-text-low mt-1">
                          Cryptographically verifies the original signer's signature. Cannot be spoofed without the private key.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Strict Mode (only shown when verification is enabled) */}
              {localConfig.verificationEnabled && (
                <div className="mt-3 pt-3 border-t border-stroke-low">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localConfig.strictVerification}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          strictVerification: e.target.checked,
                        })
                      }
                      className="mt-1 w-4 h-4 text-semantic-error rounded focus:ring-semantic-error accent-semantic-error"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-text-high">Strict Mode</div>
                      <div className="text-sm text-text-low mt-1">
                        Block content display when verification fails. You'll be asked to confirm before viewing unverified content.
                      </div>
                      <div className="mt-2 text-xs text-semantic-success">
                        Recommended for maximum security when handling sensitive transactions.
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {/* Concurrency Setting (only shown when verification is enabled) */}
              {localConfig.verificationEnabled && (
                <div className="mt-3 pt-3 border-t border-stroke-low">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-text-high">
                      Parallel Verifications
                    </label>
                    <span className="text-sm font-mono text-accent-teal-primary">
                      {localConfig.verificationConcurrency}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={localConfig.verificationConcurrency}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        verificationConcurrency: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-2 bg-container-L3 rounded-lg appearance-none cursor-pointer accent-accent-teal-primary"
                  />
                  <div className="flex justify-between text-xs text-text-low mt-1">
                    <span>1 (Slower)</span>
                    <span>20 (Faster)</span>
                  </div>
                  <div className="text-xs text-text-low mt-2">
                    Higher values load faster but may trigger rate limits on some gateways.
                  </div>
                </div>
              )}

              {/* Show verification gateways when enabled */}
              {localConfig.verificationEnabled && (
                <div className="mt-3 pt-3 border-t border-stroke-low">
                  <div className="text-xs font-semibold text-text-low mb-2">
                    Verification Gateways (Top Staked)
                  </div>
                  {loadingGateways ? (
                    <div className="text-xs text-text-low">Loading gateways...</div>
                  ) : verificationGateways.length > 0 ? (
                    <div className="space-y-1">
                      {verificationGateways.map((gateway, index) => (
                        <div
                          key={gateway}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="text-accent-teal-primary font-mono">#{index + 1}</span>
                          <a
                            href={gateway}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-high hover:text-accent-teal-primary truncate font-mono"
                            title={gateway}
                          >
                            {gateway.replace('https://', '')}
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-text-low">No gateways available</div>
                  )}
                  <div className="mt-2 text-xs text-text-low">
                    Content is verified using these top-staked gateways for integrity.
                  </div>
                </div>
              )}
            </div>

            {/* Telemetry */}
            <div className="border border-stroke-low rounded-lg p-3 bg-container-L2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.telemetryEnabled}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      telemetryEnabled: e.target.checked,
                    })
                  }
                  className="w-4 h-4 text-accent-teal-primary rounded focus:ring-accent-teal-primary accent-accent-teal-primary"
                />
                <div className="flex-1">
                  <div className="font-medium text-text-high">Enable Telemetry</div>
                  <div className="text-sm text-text-low mt-1">
                    Help improve Wayfinder by sharing anonymous usage data
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-stroke-low bg-container-L2">
            <div className="flex gap-3 mb-2">
              <button
                onClick={handleCancel}
                className="flex-1 px-4 py-2 border border-stroke-low text-text-high rounded-lg hover:bg-container-L3 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 px-4 py-2 bg-accent-teal-primary text-container-L0 rounded-lg hover:bg-accent-teal-secondary transition-colors font-medium"
              >
                Save Changes
              </button>
            </div>
            <div className="flex items-center justify-center gap-3 text-xs">
              <a
                href="https://github.com/vilenarios/wayfinder-app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-low hover:text-accent-teal-primary transition-colors"
              >
                Wayfinder v{packageJson.version}
              </a>
              <span className="text-text-low">|</span>
              <a
                href="https://chromewebstore.google.com/detail/ario-wayfinder/hnhmeknhajanolcoihhkkaaimapnmgil?hl=en-US&pli=1"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-teal-primary hover:text-accent-teal-secondary transition-colors"
              >
                Get the extension
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
