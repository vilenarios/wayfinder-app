/**
 * Wayfinder client instance for service worker.
 *
 * Creates and manages the Wayfinder client with:
 * - HashVerificationStrategy using top-staked gateways
 * - Routing strategy using broader gateway pool
 */

import { createWayfinderClient, HashVerificationStrategy, createRoutingStrategy } from '@ar.io/wayfinder-core';
import type { Wayfinder } from '@ar.io/wayfinder-core';
import type { WayfinderConfig } from './types';
// Note: Verification counting is handled in manifest-verifier.ts, not via Wayfinder callbacks

declare const self: ServiceWorkerGlobalScope;

let wayfinderInstance: Wayfinder | null = null;
let currentConfig: WayfinderConfig | null = null;

// Selected gateway for current manifest verification
// When set, all resource fetches use this gateway instead of random selection
let selectedGateway: URL | null = null;

/**
 * Set a specific gateway for all subsequent resource fetches.
 * Used to ensure all resources in a manifest come from the same gateway.
 */
export function setSelectedGateway(gateway: string | null): void {
  selectedGateway = gateway ? new URL(gateway) : null;
  console.log('[SW] Selected gateway:', selectedGateway?.hostname || 'none (random)');
}

/**
 * Get the currently selected gateway.
 */
export function getSelectedGateway(): string | null {
  return selectedGateway?.toString() || null;
}

/**
 * Try to create verification settings with HashVerificationStrategy.
 * Returns null if crypto is not available (dev mode).
 */
function tryCreateVerificationSettings(
  trustedGateways: URL[],
  strict: boolean,
  onSuccess: (event: { txId: string }) => void,
  onFailure: (error: Error) => void
) {
  try {
    const strategy = new HashVerificationStrategy({ trustedGateways });

    return {
      enabled: true,
      strategy,
      strict,
      events: {
        onVerificationSucceeded: onSuccess,
        onVerificationFailed: onFailure,
      },
    };
  } catch (error) {
    console.warn('[SW] Failed to create HashVerificationStrategy (dev mode?):', error);
    return null;
  }
}

/**
 * Initialize the Wayfinder client with the given configuration.
 */
export function initializeWayfinder(config: WayfinderConfig): void {
  console.log('[SW] Initializing Wayfinder with config:', {
    enabled: config.enabled,
    strict: config.strict,
    routingStrategy: config.routingStrategy,
    trustedGateways: config.trustedGateways.length,
    routingGateways: config.routingGateways?.length || 0,
  });

  currentConfig = config;

  // VERIFICATION gateways: Top-staked gateways used to verify content hashes
  const verificationGateways = config.trustedGateways.map(url => new URL(url));
  console.log('[SW] Verification gateways:', verificationGateways.map(u => u.hostname));

  // ROUTING gateways: Broader pool for load distribution
  // These are separate from verification gateways
  const routingGateways = config.routingGateways && config.routingGateways.length > 0
    ? config.routingGateways.map(url => new URL(url))
    : verificationGateways;
  console.log('[SW] Routing gateways:', routingGateways.length);

  // Create gateways provider for routing
  const gatewaysProvider = {
    async getGateways() {
      // If a specific gateway is selected (for manifest consistency), use only that
      if (selectedGateway) {
        return [selectedGateway];
      }

      // Otherwise shuffle for load distribution
      const shuffled = [...routingGateways];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    },
  };

  // Create routing strategy
  const routingStrategy = createRoutingStrategy({
    strategy: config.routingStrategy as any,
    gatewaysProvider,
  });

  // Try to create verification settings
  let verificationSettings: ReturnType<typeof tryCreateVerificationSettings> | { enabled: false } = { enabled: false };

  if (config.enabled) {
    // Always use strict mode internally so wayfinder.request() throws on verification failure.
    // This ensures we accurately track verification status.
    // The user's "strict verification" setting only controls whether to BLOCK content display,
    // not whether to accurately detect verification failures.
    const settings = tryCreateVerificationSettings(
      verificationGateways,
      true, // Always strict internally - we need errors thrown to track failures
      (event) => {
        // Hash verification succeeded - just log, counting is handled in manifest-verifier
        console.log(`[SW] ✓ Hash verified: ${event.txId.slice(0, 8)}...`);
      },
      (error: Error & { txId?: string }) => {
        // Hash verification failed - just log, counting is handled in manifest-verifier
        console.warn(`[SW] ✗ Hash verification failed:`, error);
      }
    );

    if (settings) {
      verificationSettings = settings;
    } else {
      console.warn('[SW] Verification disabled - crypto not available (dev mode)');
    }
  }

  wayfinderInstance = createWayfinderClient({
    routingSettings: {
      strategy: routingStrategy,
    },
    verificationSettings,
    telemetrySettings: {
      enabled: false,
    },
  });

  console.log('[SW] Wayfinder initialized', {
    verificationEnabled: verificationSettings.enabled,
    strictMode: config.strict,
  });
}

/**
 * Get the Wayfinder client instance.
 * Throws if not initialized.
 */
export function getWayfinder(): Wayfinder {
  if (!wayfinderInstance) {
    throw new Error('Wayfinder not initialized');
  }
  return wayfinderInstance;
}

/**
 * Check if Wayfinder is ready.
 */
export function isWayfinderReady(): boolean {
  return wayfinderInstance !== null;
}

/**
 * Get the current configuration.
 */
export function getConfig(): WayfinderConfig | null {
  return currentConfig;
}
