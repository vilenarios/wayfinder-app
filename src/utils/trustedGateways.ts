import { ARIO } from '@ar.io/sdk';
import type { GatewayWithStake } from '../types';

const CACHE_KEY = 'wayfinder-trusted-gateways-v2';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const TOP_POOL_SIZE = 10; // Always fetch top 10 by stake, then pick from this pool

interface TrustedGatewayCache {
  gateways: GatewayWithStake[];
  fetchedAt: number;
}

/**
 * Get trusted gateways for verification, sorted by total stake.
 * Returns gateways with stake info for display purposes.
 *
 * @param count Number of gateways to return (1-10, default 3)
 * @returns Array of gateways with URL and stake info
 */
export async function getTrustedGateways(count: number = 3): Promise<GatewayWithStake[]> {
  const validCount = Math.max(1, Math.min(10, count));

  // Check cache for the top 10 pool
  const cached = getCachedGateways();
  if (cached) {
    // Shuffle and pick requested count from cached pool
    const shuffled = shuffleArray([...cached]);
    return shuffled.slice(0, validCount);
  }

  // Fetch from AR.IO network
  try {
    const ario = ARIO.mainnet();

    // Fetch ALL gateways since the SDK can't sort by total stake (operator + delegated)
    const result = await ario.getGateways({
      limit: 1000,
    });

    if (!result.items || result.items.length === 0) {
      throw new Error('No gateways returned from AR.IO network');
    }

    // Filter active gateways and calculate total stake (operator + delegated)
    const gatewaysWithTotalStake = result.items
      .filter(gateway => gateway.status === 'joined' && gateway.settings?.fqdn)
      .map(gateway => ({
        url: `https://${gateway.settings.fqdn}`,
        totalStake: (gateway.operatorStake || 0) + (gateway.totalDelegatedStake || 0),
      }));

    // Sort by TOTAL stake descending
    gatewaysWithTotalStake.sort((a, b) => b.totalStake - a.totalStake);

    // Take top N by total stake for the pool
    const topPool = gatewaysWithTotalStake.slice(0, TOP_POOL_SIZE);

    if (topPool.length === 0) {
      throw new Error('No active staked gateways found');
    }

    // Cache the full pool (with stake info)
    cacheGateways(topPool);

    // Shuffle and return requested count
    const shuffled = shuffleArray([...topPool]);
    return shuffled.slice(0, validCount);
  } catch (error) {
    console.error('[Gateways] Failed to fetch staked gateways:', error);
    return [{ url: 'https://turbo-gateway.com', totalStake: 0 }];
  }
}

/**
 * Get the full pool of top-staked gateways (for display in settings).
 * Returns all top 10 gateways sorted by stake (not shuffled).
 */
export async function getTopStakedGateways(): Promise<GatewayWithStake[]> {
  // Check cache
  const cached = getCachedGateways();
  if (cached) {
    // Return sorted by stake (cache is already sorted)
    return cached;
  }

  // Fetch fresh - this will also populate the cache
  // Call with max count to ensure we get full pool
  await getTrustedGateways(TOP_POOL_SIZE);

  // Now return from cache (sorted)
  const freshCached = getCachedGateways();
  return freshCached || [{ url: 'https://turbo-gateway.com', totalStake: 0 }];
}

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getCachedGateways(): GatewayWithStake[] | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const parsed: TrustedGatewayCache = JSON.parse(cached);
    const age = Date.now() - parsed.fetchedAt;

    if (age > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return parsed.gateways;
  } catch {
    return null;
  }
}

function cacheGateways(gateways: GatewayWithStake[]): void {
  try {
    const cache: TrustedGatewayCache = {
      gateways,
      fetchedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Silent fail - caching is optional
  }
}

export function clearTrustedGatewayCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * Fetch gateways from an AR.IO gateway's /ar-io/peers endpoint.
 */
async function fetchPeersFromGateway(gatewayUrl: string): Promise<URL[]> {
  const response = await fetch(`${gatewayUrl}/ar-io/peers`, {
    signal: AbortSignal.timeout(10000), // 10 second timeout
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch peers from ${gatewayUrl}: ${response.status}`);
  }

  const data = await response.json();

  // Extract gateway URLs from response
  // Format: { gateways: { "domain:port": { url: "https://...", dataWeight: 50 }, ... } }
  const gateways: URL[] = [];

  if (data.gateways && typeof data.gateways === 'object') {
    // Extract URLs from gateway objects
    for (const gatewayInfo of Object.values(data.gateways)) {
      const info = gatewayInfo as { url?: string };
      if (info.url && typeof info.url === 'string') {
        try {
          gateways.push(new URL(info.url));
        } catch {
          // Skip invalid URLs
        }
      }
    }
  } else if (Array.isArray(data)) {
    // Fallback: handle array format if endpoint changes
    for (const peer of data) {
      if (!peer || typeof peer !== 'string') continue;
      try {
        if (peer.startsWith('http://') || peer.startsWith('https://')) {
          gateways.push(new URL(peer));
        } else {
          gateways.push(new URL(`https://${peer}`));
        }
      } catch {
        // Skip invalid URLs
      }
    }
  }

  if (gateways.length === 0) {
    throw new Error('No valid gateways found in peers response');
  }

  return gateways;
}

/**
 * Fetch gateways from AR.IO network contract using SDK.
 * This is the most reliable method but requires an API call to the smart contract.
 */
async function fetchGatewaysFromSDK(): Promise<URL[]> {
  try {
    const ario = ARIO.mainnet();

    // Fetch active gateways from the network
    const result = await ario.getGateways({
      limit: 100, // Get a good pool size
    });

    if (!result.items || result.items.length === 0) {
      throw new Error('No gateways returned from AR.IO network');
    }

    // Filter for active gateways with valid FQDNs
    const gateways = result.items
      .filter(gateway => gateway.status === 'joined' && gateway.settings?.fqdn)
      .map(gateway => new URL(`https://${gateway.settings.fqdn}`));

    if (gateways.length === 0) {
      throw new Error('No active gateways with FQDNs found');
    }

    return gateways;
  } catch (error) {
    console.error('[Gateways] Failed to fetch from AR.IO SDK:', error);
    throw error;
  }
}

/**
 * Get a broader pool of gateways for content routing/fetching.
 *
 * Strategy:
 * 1. Try turbo-gateway.com/ar-io/peers (primary)
 * 2. Try permagate.io/ar-io/peers (secondary)
 * 3. Use AR.IO SDK to fetch from network contract (most reliable)
 * 4. Return empty array (caller will use verification gateways as fallback)
 */
export async function getRoutingGateways(): Promise<URL[]> {
  // Try turbo-gateway.com first
  try {
    console.log('[Gateways] Fetching from turbo-gateway.com/ar-io/peers');
    const gateways = await fetchPeersFromGateway('https://turbo-gateway.com');

    // Shuffle for load distribution
    for (let i = gateways.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [gateways[i], gateways[j]] = [gateways[j], gateways[i]];
    }

    // Return a reasonable subset (e.g., 20 gateways)
    const subset = gateways.slice(0, Math.min(20, gateways.length));
    console.log(`[Gateways] Got ${subset.length} gateways from turbo-gateway.com`);
    return subset;
  } catch (error) {
    console.warn('[Gateways] turbo-gateway.com failed, trying permagate.io:', error);
  }

  // Try permagate.io as fallback
  try {
    console.log('[Gateways] Fetching from permagate.io/ar-io/peers');
    const gateways = await fetchPeersFromGateway('https://permagate.io');

    // Shuffle for load distribution
    for (let i = gateways.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [gateways[i], gateways[j]] = [gateways[j], gateways[i]];
    }

    const subset = gateways.slice(0, Math.min(20, gateways.length));
    console.log(`[Gateways] Got ${subset.length} gateways from permagate.io`);
    return subset;
  } catch (error) {
    console.warn('[Gateways] permagate.io failed, falling back to AR.IO SDK:', error);
  }

  // Ultimate fallback: use AR.IO SDK to fetch from network contract
  try {
    console.log('[Gateways] Fetching from AR.IO network via SDK');
    const gateways = await fetchGatewaysFromSDK();

    // Shuffle for load distribution
    for (let i = gateways.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [gateways[i], gateways[j]] = [gateways[j], gateways[i]];
    }

    const subset = gateways.slice(0, Math.min(20, gateways.length));
    console.log(`[Gateways] Got ${subset.length} gateways from AR.IO SDK`);
    return subset;
  } catch (error) {
    console.error('[Gateways] All routing gateway sources failed:', error);
    // Return empty array - service worker will fall back to verification gateways
    return [];
  }
}
