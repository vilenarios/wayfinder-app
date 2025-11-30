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

    // Fetch more gateways so we can sort by TOTAL stake (operator + delegated)
    // The SDK only sorts by individual fields, not combined totals
    const result = await ario.getGateways({
      sortBy: 'operatorStake',
      sortOrder: 'desc',
      limit: 50, // Fetch more to ensure we get the true top by total stake
    });

    console.log('Gateways result:', {
      totalItems: result.totalItems,
      limit: result.limit,
      itemCount: result.items?.length,
    });

    if (!result.items || result.items.length === 0) {
      throw new Error('No gateways returned from AR.IO network');
    }

    // Filter active gateways and calculate total stake
    const gatewaysWithTotalStake = result.items
      .filter(gateway => gateway.status === 'joined' && gateway.settings?.fqdn)
      .map(gateway => {
        const totalStake = (gateway.operatorStake || 0) + (gateway.totalDelegatedStake || 0);
        return {
          domain: gateway.settings.fqdn,
          operatorStake: gateway.operatorStake || 0,
          delegatedStake: gateway.totalDelegatedStake || 0,
          totalStake,
        };
      });

    // Sort by TOTAL stake (operator + delegated) descending
    gatewaysWithTotalStake.sort((a, b) => b.totalStake - a.totalStake);

    // Take top N
    const topGateways = gatewaysWithTotalStake.slice(0, TOP_N_GATEWAYS);

    // Log the selected gateways
    topGateways.forEach(gw => {
      console.log(`Gateway ${gw.domain}: operatorStake=${gw.operatorStake}, delegatedStake=${gw.delegatedStake}, totalStake=${gw.totalStake}`);
    });

    const gatewayUrls = topGateways.map(gw => `https://${gw.domain}`);

    if (gatewayUrls.length === 0) {
      throw new Error('No active staked gateways found');
    }

    console.log(`Found ${gatewayUrls.length} top-staked gateways (by total stake):`, gatewayUrls);

    // Cache
    cacheGateways(gatewayUrls);

    return gatewayUrls.map(url => new URL(url));
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
 * This fetches from arweave.net/ar-io/peers which returns active gateways.
 */
export async function getRoutingGateways(): Promise<URL[]> {
  try {
    console.log('Fetching routing gateways from arweave.net/ar-io/peers...');
    const response = await fetch('https://arweave.net/ar-io/peers');
    if (!response.ok) {
      throw new Error(`Failed to fetch peers: ${response.status}`);
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
      console.log(`Parsed ${gateways.length} gateways from peers endpoint`);
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
    } else {
      throw new Error('Unexpected response format from peers endpoint');
    }

    if (gateways.length === 0) {
      throw new Error('No valid gateways found in peers response');
    }

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
