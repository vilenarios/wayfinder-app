import { useState, useEffect } from 'react';
import { useWayfinderConfig } from '../context/WayfinderConfigContext';
import { ROUTING_STRATEGY_OPTIONS } from '../utils/constants';
import type { WayfinderConfig } from '../types';
import packageJson from '../../package.json';

interface SettingsFlyoutProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsFlyout({ isOpen, onClose }: SettingsFlyoutProps) {
  const { config, updateConfig } = useWayfinderConfig();
  const [localConfig, setLocalConfig] = useState<WayfinderConfig>(config);

  useEffect(() => {
    // Sync local state with context when settings open or config changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalConfig(config);
  }, [config, isOpen]);

  const handleSave = () => {
    // Trim the preferred gateway URL before saving
    const configToSave = {
      ...localConfig,
      preferredGateway: localConfig.preferredGateway?.trim(),
    };
    updateConfig(configToSave);
    onClose();
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
            <div>
              <label className="block text-sm font-semibold text-text-high mb-2">
                Routing Strategy
              </label>
              <div className="space-y-2">
                {ROUTING_STRATEGY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-3 p-2 border border-stroke-low rounded-lg cursor-pointer hover:bg-container-L2 transition-colors bg-container-L2"
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
            </div>

            {/* Preferred Gateway (conditional) */}
            {localConfig.routingStrategy === 'preferred' && (
              <div>
                <label className="block text-sm font-semibold text-text-high mb-2">
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
                  className="w-full px-4 py-2 bg-container-L2 border border-stroke-low text-text-high placeholder:text-text-low rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-teal-primary focus:border-transparent"
                />
                <p className="text-sm text-text-low mt-2">
                  Enter your preferred gateway URL. This gateway will always be used for all requests (e.g., https://arweave.net, https://g8way.io).
                </p>
              </div>
            )}

            {/* Telemetry */}
            <div>
              <label className="flex items-center gap-3 p-2 border border-stroke-low rounded-lg cursor-pointer hover:bg-container-L2 transition-colors bg-container-L2">
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
