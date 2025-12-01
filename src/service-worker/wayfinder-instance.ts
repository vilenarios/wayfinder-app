/**
 * Wayfinder client instance for service worker.
 *
 * Creates and manages the Wayfinder client with:
 * - Verification strategy (hash or signature) using top-staked gateways
 * - Routing strategy using broader gateway pool
 */

import { createWayfinderClient, HashVerificationStrategy, SignatureVerificationStrategy, createRoutingStrategy } from '@ar.io/wayfinder-core';
import type { Wayfinder, VerificationStrategy } from '@ar.io/wayfinder-core';
import type { SwWayfinderConfig, VerificationMethod } from './types';
import { logger } from './logger';
// Note: Verification counting is handled in manifest-verifier.ts, not via Wayfinder callbacks

const TAG = 'Wayfinder';

let wayfinderInstance: Wayfinder | null = null;
let currentConfig: SwWayfinderConfig | null = null;

// Selected gateway for current manifest verification
// When set, all resource fetches use this gateway instead of random selection
let selectedGateway: URL | null = null;

// Promise that resolves when Wayfinder is initialized
// Used by fetch handler to wait for initialization instead of returning 503
let initializationResolve: (() => void) | null = null;
let initializationPromise: Promise<void> | null = null;

/**
 * Wait for Wayfinder to be initialized.
 * Returns immediately if already initialized, otherwise waits up to maxWaitMs.
 *
 * @param maxWaitMs Maximum time to wait in milliseconds (default 10 seconds)
 * @returns true if initialized, false if timed out
 */
export async function waitForInitialization(maxWaitMs = 10000): Promise<boolean> {
  // Already initialized
  if (wayfinderInstance !== null) {
    return true;
  }

  // Create the promise if it doesn't exist
  if (!initializationPromise) {
    initializationPromise = new Promise<void>((resolve) => {
      initializationResolve = resolve;
    });
  }

  // Race between initialization and timeout
  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), maxWaitMs);
  });

  const initPromise = initializationPromise.then(() => true);

  const result = await Promise.race([initPromise, timeoutPromise]);

  return result;
}

/**
 * Set a specific gateway for all subsequent resource fetches.
 * Used to ensure all resources in a manifest come from the same gateway.
 */
export function setSelectedGateway(gateway: string | null): void {
  selectedGateway = gateway ? new URL(gateway) : null;
  logger.debug(TAG, `Gateway: ${selectedGateway?.hostname || 'random'}`);
}

/**
 * Get the currently selected gateway.
 */
export function getSelectedGateway(): string | null {
  return selectedGateway?.toString() || null;
}

// Quiet logger for Wayfinder core - suppresses debug/info logs to reduce noise
const quietWayfinderLogger = {
  debug: () => {}, // Suppress debug logs
  info: () => {},  // Suppress info logs
  warn: console.warn,
  error: console.error,
};

/**
 * Create a verification strategy based on the specified method.
 * - 'hash': Fast SHA-256 hash comparison (default)
 * - 'signature': Cryptographic signature verification (most secure)
 */
function createVerificationStrategyFromMethod(
  method: VerificationMethod,
  trustedGateways: URL[]
): VerificationStrategy {
  switch (method) {
    case 'signature':
      logger.debug(TAG, 'Using SignatureVerificationStrategy');
      return new SignatureVerificationStrategy({ trustedGateways, logger: quietWayfinderLogger });
    case 'hash':
    default:
      logger.debug(TAG, 'Using HashVerificationStrategy');
      return new HashVerificationStrategy({ trustedGateways, logger: quietWayfinderLogger });
  }
}

/**
 * Try to create verification settings with the specified strategy.
 * Returns null if crypto is not available (dev mode).
 */
function tryCreateVerificationSettings(
  trustedGateways: URL[],
  strict: boolean,
  verificationMethod: VerificationMethod,
  onSuccess: (event: { txId: string }) => void,
  onFailure: (error: Error) => void
) {
  try {
    const strategy = createVerificationStrategyFromMethod(verificationMethod, trustedGateways);

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
    logger.warn(TAG, `Strategy creation failed (${verificationMethod}):`, error);
    return null;
  }
}

/**
 * Initialize the Wayfinder client with the given configuration.
 */
export function initializeWayfinder(config: SwWayfinderConfig): void {
  const verificationMethod = config.verificationMethod || 'hash';

  logger.info(TAG, `Init: ${verificationMethod}, ${config.trustedGateways.length} verification gateways`);

  currentConfig = config;

  // VERIFICATION gateways: Top-staked gateways used for content verification
  const verificationGateways = config.trustedGateways.map(url => new URL(url));
  logger.debug(TAG, `Verification gateways:`, verificationGateways.map(u => u.hostname));

  // ROUTING gateways: Broader pool for load distribution
  // These are separate from verification gateways
  const routingGateways = config.routingGateways && config.routingGateways.length > 0
    ? config.routingGateways.map(url => new URL(url))
    : verificationGateways;
  logger.debug(TAG, `Routing gateways: ${routingGateways.length}`);

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
  // Strategy type comes from config which may not match the exact enum type
  const routingStrategy = createRoutingStrategy({
    strategy: config.routingStrategy as 'random' | 'fastest' | 'balanced',
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
      verificationMethod,
      (event) => {
        // Verification succeeded - just log, counting is handled in manifest-verifier
        logger.debug(TAG, `✓ ${event.txId.slice(0, 8)}...`);
      },
      (error: Error & { txId?: string }) => {
        // Verification failed - just log, counting is handled in manifest-verifier
        logger.debug(TAG, `✗ Verification failed:`, error.message);
      }
    );

    if (settings) {
      verificationSettings = settings;
    } else {
      logger.warn(TAG, 'Verification disabled - crypto not available');
    }
  }

  wayfinderInstance = createWayfinderClient({
    logger: quietWayfinderLogger,
    routingSettings: {
      strategy: routingStrategy,
    },
    verificationSettings,
    telemetrySettings: {
      enabled: false,
    },
  });

  // Resolve any pending initialization waiters
  if (initializationResolve) {
    initializationResolve();
    initializationResolve = null;
    initializationPromise = null;
  }

  logger.info(TAG, `Ready: verification=${verificationSettings.enabled ? verificationMethod : 'disabled'}, strict=${config.strict}`);
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
export function getConfig(): SwWayfinderConfig | null {
  return currentConfig;
}
