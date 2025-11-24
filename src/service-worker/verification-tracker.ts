import type { VerificationEvent } from './types';

declare const self: ServiceWorkerGlobalScope;

export class VerificationTracker {
  private verificationStatus = new Map<string, {
    total: number;
    verified: number;
    failed: number;
  }>();

  /**
   * Start tracking verification for a manifest
   */
  startManifestVerification(manifestTxId: string, totalResources: number): void {
    this.verificationStatus.set(manifestTxId, {
      total: totalResources,
      verified: 0,
      failed: 0,
    });

    this.broadcastEvent({
      type: 'verification-started',
      txId: manifestTxId,
      progress: {
        current: 0,
        total: totalResources,
      },
    });
  }

  /**
   * Record successful verification
   */
  recordSuccess(manifestTxId: string, resourceTxId: string): void {
    const status = this.verificationStatus.get(manifestTxId);
    if (!status) return;

    status.verified++;

    this.broadcastEvent({
      type: 'verification-progress',
      txId: manifestTxId,
      resourcePath: resourceTxId,
      progress: {
        current: status.verified + status.failed,
        total: status.total,
      },
    });

    // Check if complete
    if (status.verified + status.failed >= status.total) {
      this.broadcastEvent({
        type: 'verification-success',
        txId: manifestTxId,
        progress: {
          current: status.total,
          total: status.total,
        },
      });
    }
  }

  /**
   * Record failed verification
   */
  recordFailure(manifestTxId: string, resourceTxId: string, error: string): void {
    const status = this.verificationStatus.get(manifestTxId);
    if (!status) return;

    status.failed++;

    this.broadcastEvent({
      type: 'verification-failed',
      txId: manifestTxId,
      resourcePath: resourceTxId,
      error,
    });
  }

  /**
   * Broadcast event to all clients
   */
  private async broadcastEvent(event: VerificationEvent): Promise<void> {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'VERIFICATION_EVENT',
        event,
      });
    });
  }

  /**
   * Clear tracking data
   */
  clear(): void {
    this.verificationStatus.clear();
  }
}
