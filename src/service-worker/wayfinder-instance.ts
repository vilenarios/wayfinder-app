import { createWayfinderClient, HashVerificationStrategy, createRoutingStrategy } from '@ar.io/wayfinder-core';
import type { Wayfinder } from '@ar.io/wayfinder-core';
import type { WayfinderConfig, VerificationEvent } from './types';

declare const self: ServiceWorkerGlobalScope;

let wayfinderInstance: Wayfinder | null = null;

/**
 * Broadcast verification event to all clients
 */
async function broadcastVerificationEvent(event: VerificationEvent): Promise<void> {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'VERIFICATION_EVENT',
      event,
    });
  });
}

/**
 * Try to create verification settings with HashVerificationStrategy
 * Returns null if crypto is not available (dev mode)
 */
function tryCreateVerificationSettings(
  trustedGateways: URL[],
  onSuccess: (event: { txId: string }) => void,
  onFailure: (error: Error) => void
) {
  try {
    // This will fail in dev mode because crypto-browserify isn't available
    const strategy = new HashVerificationStrategy({ trustedGateways });

    return {
      enabled: true,
      strategy,
      strict: false, // Non-blocking - content still loads if verification fails
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

export function initializeWayfinder(config: WayfinderConfig): void {
  console.log('[SW] Initializing Wayfinder with config:', config);

  // VERIFICATION gateways: Top-staked gateways used to verify content hashes
  const verificationGateways = config.trustedGateways.map(url => new URL(url));
  console.log('[SW] Verification gateways (top-staked):', verificationGateways.map(u => u.toString()));

  // ROUTING gateways: Broader pool for load distribution
  // If routingGateways provided, use those; otherwise fall back to verification gateways
  const routingGateways = config.routingGateways && config.routingGateways.length > 0
    ? config.routingGateways.map(url => new URL(url))
    : verificationGateways;
  console.log('[SW] Routing gateways:', routingGateways.map(u => u.toString()));

  // Create gateways provider for routing
  const gatewaysProvider = {
    async getGateways() {
      // Shuffle the gateways for load distribution
      const shuffled = [...routingGateways];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      console.log('[SW] Routing gateways (shuffled):', shuffled.map(u => u.toString()));
      return shuffled;
    },
  };

  // Create routing strategy
  const routingStrategy = createRoutingStrategy({
    strategy: config.routingStrategy as any,
    gatewaysProvider,
  });

  console.log('[SW] Gateway configuration:', {
    routingStrategy: config.routingStrategy,
    routingGatewaysCount: routingGateways.length,
    verificationGatewaysCount: verificationGateways.length,
  });

  // Try to create verification settings (may fail in dev mode)
  let verificationSettings: ReturnType<typeof tryCreateVerificationSettings> | { enabled: false } = { enabled: false };

  if (config.enabled) {
    const settings = tryCreateVerificationSettings(
      verificationGateways, // Use top-staked gateways for hash verification
      (event) => {
        console.log(`[SW] ✓ Verified: ${event.txId}`);
        broadcastVerificationEvent({
          type: 'verification-success',
          txId: event.txId,
          progress: { current: 1, total: 1 },
        });
      },
      (error) => {
        console.warn(`[SW] ✗ Verification failed:`, error);
        const errorAny = error as any;
        broadcastVerificationEvent({
          type: 'verification-failed',
          txId: errorAny?.txId || 'unknown',
          error: errorAny?.message || String(error) || 'Verification failed',
        });
      }
    );

    if (settings) {
      verificationSettings = settings;
    } else {
      // Verification requested but crypto not available
      console.warn('[SW] Verification disabled - crypto not available (dev mode). Use production build for full verification.');
      broadcastVerificationEvent({
        type: 'verification-failed',
        txId: 'system',
        error: 'Verification unavailable in dev mode. Build for production to enable.',
      });
    }
  }

  wayfinderInstance = createWayfinderClient({
    routingSettings: {
      strategy: routingStrategy,
    },
    verificationSettings,
    telemetrySettings: {
      enabled: false, // Disable in SW to avoid duplicate telemetry
    },
  });

  console.log('[SW] Wayfinder initialized successfully', {
    verificationEnabled: verificationSettings.enabled,
  });
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
