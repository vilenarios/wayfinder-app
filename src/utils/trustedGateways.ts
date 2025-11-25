import { ARIO } from '@ar.io/sdk';

const CACHE_KEY = 'wayfinder-trusted-gateways';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const TOP_N_GATEWAYS = 3;

interface TrustedGatewayCache {
  gateways: string[];
  fetchedAt: number;
}

export async function getTrustedGateways(): Promise<URL[]> {
  // Check cache
  const cached = getCachedGateways();
  if (cached) {
    console.log('Using cached trusted gateways:', cached);
    return cached.map(url => new URL(url));
  }

  // Fetch from AR.IO network
  try {
    console.log('Fetching top-staked gateways from AR.IO network...');
    const ario = ARIO.mainnet();

    // SDK v3 returns PaginationResult<AoGatewayWithAddress>
    const result = await ario.getGateways({
      sortBy: 'operatorStake',
      sortOrder: 'desc',
      limit: TOP_N_GATEWAYS,
    });

    console.log('Gateways result:', {
      totalItems: result.totalItems,
      limit: result.limit,
      itemCount: result.items?.length,
    });

    if (!result.items || result.items.length === 0) {
      throw new Error('No gateways returned from AR.IO network');
    }

    // Extract top-staked gateways from the paginated result
    // Gateway structure: { settings: { fqdn: string }, operatorStake: number, totalDelegatedStake: number, ... }
    const topGateways = result.items
      .filter(gateway => {
        // Only include active gateways
        return gateway.status === 'joined' && gateway.settings?.fqdn;
      })
      .map(gateway => {
        const domain = gateway.settings.fqdn;
        const totalStake = (gateway.operatorStake || 0) + (gateway.totalDelegatedStake || 0);
        console.log(`Gateway ${domain}: operatorStake=${gateway.operatorStake}, delegatedStake=${gateway.totalDelegatedStake}, total=${totalStake}`);
        return `https://${domain}`;
      });

    if (topGateways.length === 0) {
      throw new Error('No active staked gateways found');
    }

    console.log(`Found ${topGateways.length} top-staked gateways:`, topGateways);

    // Cache
    cacheGateways(topGateways);

    return topGateways.map(url => new URL(url));
  } catch (error) {
    console.error('Failed to fetch staked gateways:', error);

    // Emergency fallback
    console.warn('Using emergency fallback: arweave.net');
    return [new URL('https://arweave.net')];
  }
}

function getCachedGateways(): string[] | null {
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

function cacheGateways(gateways: string[]): void {
  try {
    const cache: TrustedGatewayCache = {
      gateways,
      fetchedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Failed to cache trusted gateways:', error);
  }
}

export function clearTrustedGatewayCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * Get a broader pool of gateways for content routing/fetching.
 * This fetches from arweave.net/ar-io/peers which returns many active gateways.
 */
export async function getRoutingGateways(): Promise<URL[]> {
  try {
    console.log('Fetching routing gateways from arweave.net/ar-io/peers...');
    const response = await fetch('https://arweave.net/ar-io/peers');
    if (!response.ok) {
      throw new Error(`Failed to fetch peers: ${response.status}`);
    }

    const peers: string[] = await response.json();

    // Filter and convert to URLs
    const gateways = peers
      .filter(peer => peer && typeof peer === 'string')
      .map(peer => {
        // Peers are typically domain names without protocol
        if (peer.startsWith('http://') || peer.startsWith('https://')) {
          return new URL(peer);
        }
        return new URL(`https://${peer}`);
      });

    // Shuffle for load distribution
    for (let i = gateways.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [gateways[i], gateways[j]] = [gateways[j], gateways[i]];
    }

    // Return a reasonable subset (e.g., 20 gateways)
    const selected = gateways.slice(0, Math.min(20, gateways.length));
    console.log(`Selected ${selected.length} routing gateways from ${gateways.length} total peers`);

    return selected;
  } catch (error) {
    console.error('Failed to fetch routing gateways:', error);
    // Return empty array - service worker will fall back to verification gateways
    return [];
  }
}
