import { createContext, useContext, useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import type { WayfinderConfig, WayfinderConfigContextValue } from '../types';
import { DEFAULT_CONFIG, STORAGE_KEY } from '../utils/constants';

const WayfinderConfigContext = createContext<WayfinderConfigContextValue | null>(null);

export function WayfinderConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<WayfinderConfig>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Failed to load config from localStorage:', error);
    }
    return DEFAULT_CONFIG;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
      console.error('Failed to save config to localStorage:', error);
    }
  }, [config]);

  const updateConfig = useCallback((updates: Partial<WayfinderConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  // Removed isSettingsOpen from context to prevent re-renders when opening/closing settings
  const contextValue = useMemo(
    () => ({ config, updateConfig }),
    [config, updateConfig]
  );

  return (
    <WayfinderConfigContext.Provider value={contextValue}>
      {children}
    </WayfinderConfigContext.Provider>
  );
}

export function useWayfinderConfig() {
  const context = useContext(WayfinderConfigContext);
  if (!context) {
    throw new Error('useWayfinderConfig must be used within WayfinderConfigProvider');
  }
  return context;
}
