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
    const gateways = await ario.getGateways();

    console.log('Raw gateways data:', Object.entries(gateways).slice(0, 2)); // Debug: show first 2 entries

    // Sort by stake
    const sortedByStake = Object.entries(gateways)
      .map(([domain, info]) => {
        // Debug log to see actual structure
        console.log(`Gateway ${domain}:`, info);

        // AR.IO SDK returns complex gateway objects
        // Try to extract stake information safely
        let totalStake = 0;

        if (typeof info === 'object' && info !== null) {
          const anyInfo = info as any;

          // Try different possible property names
          const operatorStake = anyInfo.operatorStake || anyInfo.stake || 0;
          const delegatedStake = anyInfo.totalDelegatedStake || anyInfo.delegatedStake || 0;

          totalStake = operatorStake + delegatedStake;
        }

        return { domain, totalStake };
      })
      .filter(g => g.totalStake > 0)
      .sort((a, b) => b.totalStake - a.totalStake)
      .slice(0, TOP_N_GATEWAYS)
      .map(g => `https://${g.domain}`);

    if (sortedByStake.length === 0) {
      throw new Error('No staked gateways found');
    }

    console.log(`Found ${sortedByStake.length} top-staked gateways:`, sortedByStake);

    // Cache
    cacheGateways(sortedByStake);

    return sortedByStake.map(url => new URL(url));
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
