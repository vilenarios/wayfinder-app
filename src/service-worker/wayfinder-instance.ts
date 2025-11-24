import { createWayfinderClient, HashVerificationStrategy, createRoutingStrategy } from '@ar.io/wayfinder-core';
import type { Wayfinder } from '@ar.io/wayfinder-core';
import type { WayfinderConfig } from './types';

let wayfinderInstance: Wayfinder | null = null;

export function initializeWayfinder(config: WayfinderConfig): void {
  console.log('[SW] Initializing Wayfinder with config:', config);

  const trustedGateways = config.trustedGateways.map(url => new URL(url));

  // Create a simple gateways provider
  const gatewaysProvider = {
    async getGateways() {
      return trustedGateways;
    },
  };

  // Create routing strategy
  const routingStrategy = createRoutingStrategy({
    strategy: config.routingStrategy as any,
    gatewaysProvider,
  });

  wayfinderInstance = createWayfinderClient({
    routingSettings: {
      strategy: routingStrategy,
    },
    verificationSettings: config.enabled ? {
      enabled: true,
      strategy: new HashVerificationStrategy({ trustedGateways }),
      strict: false, // Non-blocking
      events: {
        onVerificationSucceeded: (event) => {
          console.log(`[SW] ✓ Verified: ${event.txId}`);
        },
        onVerificationFailed: (error) => {
          console.warn(`[SW] ✗ Verification failed:`, error);
        },
      },
    } : {
      enabled: false,
    },
    telemetrySettings: {
      enabled: false, // Disable in SW to avoid duplicate telemetry
    },
  });

  console.log('[SW] Wayfinder initialized successfully');
}

export function getWayfinder(): Wayfinder {
  if (!wayfinderInstance) {
    throw new Error('Wayfinder not initialized. Call initializeWayfinder first.');
  }
  return wayfinderInstance;
}

export function isWayfinderReady(): boolean {
  return wayfinderInstance !== null;
}
