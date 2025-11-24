export interface ServiceWorkerMessage {
  type: string;
  [key: string]: any;
}

export class ServiceWorkerMessenger {
  private registration: ServiceWorkerRegistration | null = null;
  private listeners = new Map<string, Set<(data: any) => void>>();

  /**
   * Initialize and register service worker
   */
  async register(scriptURL: string): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        this.registration = await navigator.serviceWorker.register(scriptURL);
        console.log('Service worker registered:', this.registration);

        // Set up message listener
        navigator.serviceWorker.addEventListener('message', (event) => {
          this.handleMessage(event.data);
        });

        // Wait for service worker to be ready
        await navigator.serviceWorker.ready;
        console.log('Service worker ready');

      } catch (error) {
        console.error('Service worker registration failed:', error);
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
    routingStrategy: string;
    preferredGateway?: string;
    enabled: boolean;
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
}

// Singleton instance
export const swMessenger = new ServiceWorkerMessenger();
