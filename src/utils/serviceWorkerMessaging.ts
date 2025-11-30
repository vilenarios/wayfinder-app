export interface ServiceWorkerMessage {
  type: string;
  [key: string]: any;
}

export class ServiceWorkerMessenger {
  private listeners = new Map<string, Set<(data: any) => void>>();

  /**
   * Initialize and register service worker
   * @param scriptURL - URL to the service worker script
   * @param options - Registration options (e.g., { type: 'module' } for ES module service workers)
   */
  async register(scriptURL: string, options?: RegistrationOptions): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register(scriptURL, options);

        // Set up message listener
        navigator.serviceWorker.addEventListener('message', (event) => {
          this.handleMessage(event.data);
        });

        // Wait for service worker to be ready
        await navigator.serviceWorker.ready;

        // Wait for controller to be available (service worker needs to control the page)
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              resolve();
            }, { once: true });

            // Also timeout after 2 seconds if no control
            setTimeout(() => {
              resolve();
            }, 2000);
          });
        }

      } catch (error) {
        console.error('[SW] Registration failed:', error);
        throw error;
      }
    } else {
      throw new Error('Service workers not supported');
    }
  }

  /**
   * Send message to service worker
   */
  async send(message: ServiceWorkerMessage): Promise<any> {
    const controller = navigator.serviceWorker.controller;
    if (!controller) {
      throw new Error('No service worker controller');
    }

    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();

      messageChannel.port1.onmessage = (event) => {
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data);
        }
      };

      controller.postMessage(message, [messageChannel.port2]);
    });
  }

  /**
   * Listen for specific message types
   */
  on(type: string, callback: (data: any) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    this.listeners.get(type)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: ServiceWorkerMessage): void {
    const listeners = this.listeners.get(data.type);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  /**
   * Initialize Wayfinder in service worker
   */
  async initializeWayfinder(config: {
    trustedGateways: string[];
    routingGateways?: string[];
    routingStrategy: string;
    preferredGateway?: string;
    enabled: boolean;
    strict: boolean;
    concurrency?: number;
    verificationMethod?: 'hash' | 'signature';
  }): Promise<void> {
    await this.send({
      type: 'INIT_WAYFINDER',
      config,
    });
  }

  /**
   * Clear all caches in service worker
   */
  async clearCache(): Promise<void> {
    await this.send({
      type: 'CLEAR_CACHE',
    });
  }

  /**
   * Clear verification state and cached resources for a specific identifier.
   * Use this before retrying verification to ensure fresh verification.
   */
  async clearVerification(identifier: string): Promise<void> {
    await this.send({
      type: 'CLEAR_VERIFICATION',
      identifier,
    });
  }
}

// Singleton instance
export const swMessenger = new ServiceWorkerMessenger();
