/**
 * Cache for verified Arweave resources.
 *
 * Resources are cached after successful hash verification.
 * Cache is keyed by transaction ID for deduplication.
 * Includes LRU eviction when size limit is exceeded.
 */

// Maximum cache size in bytes (100MB)
const MAX_CACHE_SIZE = 100 * 1024 * 1024;

export interface VerifiedResource {
  txId: string;
  contentType: string;
  data: ArrayBuffer;
  headers: Record<string, string>;
  verifiedAt: number;
  lastAccessedAt: number;
}

class VerifiedCacheImpl {
  private cache = new Map<string, VerifiedResource>();
  private currentSize = 0;

  /**
   * Store a verified resource in cache.
   * Evicts LRU items if cache size limit is exceeded.
   */
  set(txId: string, resource: Omit<VerifiedResource, 'txId' | 'verifiedAt' | 'lastAccessedAt'>): void {
    const resourceSize = resource.data.byteLength;

    // If single resource is larger than cache, don't cache it
    if (resourceSize > MAX_CACHE_SIZE) {
      console.warn(`[Cache] Resource too large to cache: ${txId} (${resourceSize} bytes)`);
      return;
    }

    // Evict LRU items if needed
    while (this.currentSize + resourceSize > MAX_CACHE_SIZE && this.cache.size > 0) {
      this.evictLRU();
    }

    // Remove existing entry if present (to update size correctly)
    if (this.cache.has(txId)) {
      const existing = this.cache.get(txId)!;
      this.currentSize -= existing.data.byteLength;
    }

    const now = Date.now();
    this.cache.set(txId, {
      txId,
      ...resource,
      verifiedAt: now,
      lastAccessedAt: now,
    });
    this.currentSize += resourceSize;

    console.log(`[Cache] Stored verified resource: ${txId} (${resource.contentType}, ${resourceSize} bytes, total: ${(this.currentSize / 1024 / 1024).toFixed(1)}MB)`);
  }

  /**
   * Evict the least recently used item from cache.
   */
  private evictLRU(): void {
    let oldest: { txId: string; time: number } | null = null;

    for (const [txId, resource] of this.cache) {
      if (!oldest || resource.lastAccessedAt < oldest.time) {
        oldest = { txId, time: resource.lastAccessedAt };
      }
    }

    if (oldest) {
      const evicted = this.cache.get(oldest.txId)!;
      this.currentSize -= evicted.data.byteLength;
      this.cache.delete(oldest.txId);
      console.log(`[Cache] Evicted LRU: ${oldest.txId}`);
    }
  }

  /**
   * Get a verified resource from cache.
   * Updates last accessed time for LRU tracking.
   */
  get(txId: string): VerifiedResource | null {
    const resource = this.cache.get(txId);
    if (resource) {
      // Update last accessed time for LRU
      resource.lastAccessedAt = Date.now();
    }
    return resource || null;
  }

  /**
   * Check if a resource is cached.
   */
  has(txId: string): boolean {
    return this.cache.has(txId);
  }

  /**
   * Get multiple resources by txId.
   */
  getMany(txIds: string[]): Map<string, VerifiedResource> {
    const results = new Map<string, VerifiedResource>();
    for (const txId of txIds) {
      const resource = this.cache.get(txId);
      if (resource) {
        results.set(txId, resource);
      }
    }
    return results;
  }

  /**
   * Create a Response from a cached resource.
   */
  toResponse(resource: VerifiedResource): Response {
    const headers = new Headers(resource.headers);
    // Ensure content-type is set
    if (!headers.has('content-type') && resource.contentType) {
      headers.set('content-type', resource.contentType);
    }
    // Add verification header
    headers.set('x-wayfinder-verified', 'true');
    headers.set('x-wayfinder-verified-at', resource.verifiedAt.toString());

    return new Response(resource.data, {
      status: 200,
      headers,
    });
  }

  /**
   * Get cache stats.
   */
  getStats(): { count: number; totalBytes: number } {
    let totalBytes = 0;
    for (const resource of this.cache.values()) {
      totalBytes += resource.data.byteLength;
    }
    return {
      count: this.cache.size,
      totalBytes,
    };
  }

  /**
   * Clear all cached resources.
   */
  clear(): void {
    const stats = this.getStats();
    this.cache.clear();
    this.currentSize = 0;
    console.log(`[Cache] Cleared ${stats.count} resources (${stats.totalBytes} bytes)`);
  }

  /**
   * Clear resources for a specific manifest/identifier.
   * Takes a list of txIds that belong to that manifest.
   */
  clearForManifest(txIds: string[]): void {
    let cleared = 0;
    let freedBytes = 0;
    for (const txId of txIds) {
      const resource = this.cache.get(txId);
      if (resource) {
        freedBytes += resource.data.byteLength;
        this.cache.delete(txId);
        cleared++;
      }
    }
    this.currentSize -= freedBytes;
    console.log(`[Cache] Cleared ${cleared} resources for manifest (${freedBytes} bytes freed)`);
  }
}

// Singleton instance
export const verifiedCache = new VerifiedCacheImpl();
