import type { IframeContext } from './types';

export class ContextTracker {
  private contexts = new Map<string, IframeContext>();
  private readonly MAX_DEPTH = 5; // Prevent infinite nesting

  /**
   * Set context for an iframe client
   */
  setContext(clientId: string, context: IframeContext): void {
    if (context.depth > this.MAX_DEPTH) {
      throw new Error(`Maximum manifest nesting depth (${this.MAX_DEPTH}) exceeded`);
    }

    this.contexts.set(clientId, context);
    console.log(`[SW] Set context for ${clientId}:`, context);
  }

  /**
   * Get context for an iframe client
   */
  getContext(clientId: string): IframeContext | null {
    return this.contexts.get(clientId) || null;
  }

  /**
   * Remove context (cleanup on iframe close)
   */
  removeContext(clientId: string): void {
    this.contexts.delete(clientId);
  }

  /**
   * Create nested context for nested manifest
   */
  createNestedContext(
    parentClientId: string,
    nestedManifestTxId: string,
    basePath: string
  ): IframeContext {
    const parent = this.getContext(parentClientId);

    return {
      manifestTxId: nestedManifestTxId,
      basePath: basePath,
      depth: parent ? parent.depth + 1 : 0,
      parentContext: parentClientId,
    };
  }

  /**
   * Clear all contexts
   */
  clearAll(): void {
    this.contexts.clear();
  }
}
