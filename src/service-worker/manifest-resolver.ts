import type { ArweaveManifest } from './types';

export class ManifestResolver {
  private manifestCache = new Map<string, ArweaveManifest>();
  private pendingParses = new Map<string, Promise<ArweaveManifest>>();

  /**
   * Check if content looks like a manifest
   */
  isManifest(contentType: string | null, data?: string): boolean {
    if (contentType?.includes('application/x.arweave-manifest+json')) {
      return true;
    }

    // Fallback: Check if data parses as manifest
    if (data) {
      try {
        const parsed = JSON.parse(data);
        return parsed.manifest === 'arweave/paths' && parsed.paths;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Parse manifest from stream
   */
  async parseManifest(
    txId: string,
    stream: ReadableStream
  ): Promise<ArweaveManifest> {
    // Check cache first
    if (this.manifestCache.has(txId)) {
      return this.manifestCache.get(txId)!;
    }

    // Check if already parsing
    if (this.pendingParses.has(txId)) {
      return this.pendingParses.get(txId)!;
    }

    // Parse the stream
    const parsePromise = (async () => {
      try {
        const text = await new Response(stream).text();
        const manifest: ArweaveManifest = JSON.parse(text);

        // Validate structure
        if (manifest.manifest !== 'arweave/paths' || !manifest.paths) {
          throw new Error('Invalid manifest structure');
        }

        // Cache it
        this.manifestCache.set(txId, manifest);
        console.log(`[SW] Parsed manifest ${txId}: ${Object.keys(manifest.paths).length} paths`);

        return manifest;
      } catch (error) {
        console.error(`[SW] Failed to parse manifest ${txId}:`, error);
        throw error;
      } finally {
        this.pendingParses.delete(txId);
      }
    })();

    this.pendingParses.set(txId, parsePromise);
    return parsePromise;
  }

  /**
   * Resolve a path within a manifest
   */
  resolvePath(manifest: ArweaveManifest, requestPath: string): string | null {
    // Clean the path
    let path = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath;

    // Handle index
    if (path === '' || path === '/') {
      if (manifest.index?.path) {
        path = manifest.index.path;
      } else {
        path = 'index.html'; // Default
      }
    }

    // Direct lookup
    const entry = manifest.paths[path];
    if (entry?.id) {
      return entry.id;
    }

    // Try with trailing slash (directory manifest)
    if (!path.endsWith('/')) {
      const dirEntry = manifest.paths[path + '/'];
      if (dirEntry?.id) {
        return dirEntry.id; // This is a nested manifest
      }
    }

    // Fallback
    if (manifest.fallback?.id) {
      return manifest.fallback.id;
    }

    return null;
  }

  /**
   * Get all transaction IDs in a manifest
   */
  getAllTransactionIds(manifest: ArweaveManifest): string[] {
    const txIds: string[] = [];

    for (const entry of Object.values(manifest.paths)) {
      txIds.push(entry.id);
    }

    if (manifest.fallback?.id) {
      txIds.push(manifest.fallback.id);
    }

    return txIds;
  }

  /**
   * Get cached manifest
   */
  getManifest(txId: string): ArweaveManifest | null {
    return this.manifestCache.get(txId) || null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.manifestCache.clear();
    this.pendingParses.clear();
  }
}
