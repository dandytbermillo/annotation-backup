/**
 * Service Worker Manager
 * Phase 2: Intelligent Caching + Write Replay
 */

import { getFeatureFlag } from './feature-flags';
import { telemetry } from './telemetry';
import { networkService } from './network-service';

export interface WriteOperation {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timestamp: number;
  retries: number;
}

export interface QueueStatus {
  queueLength: number;
  queue: WriteOperation[];
}

class ServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null;
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private syncSupported = false;

  /**
   * Initialize and register service worker
   */
  async init(): Promise<void> {
    // Check feature flag
    if (!getFeatureFlag('offline.swCaching')) {
      console.log('[SWManager] Service worker caching disabled by feature flag');
      return;
    }

    // Check browser support
    if (!('serviceWorker' in navigator)) {
      console.log('[SWManager] Service workers not supported');
      return;
    }

    try {
      // Register service worker
      this.registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
      });

      console.log('[SWManager] Service worker registered:', this.registration);

      // Check for updates
      this.registration.addEventListener('updatefound', () => {
        console.log('[SWManager] New service worker available');
        this.handleUpdate();
      });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      // Check Background Sync support
      this.syncSupported = 'sync' in this.registration;
      console.log('[SWManager] Background Sync supported:', this.syncSupported);

      // Track initialization
      telemetry.track({
        category: 'service-worker',
        action: 'initialized',
        metadata: {
          syncSupported: this.syncSupported,
        },
      });

      // Set up periodic sync if supported
      if (this.syncSupported) {
        await this.registerBackgroundSync();
      }

      // Monitor network status changes
      networkService.onStatusChange((status) => {
        if (status.isOnline && status.quality === 'good') {
          this.triggerSync();
        }
      });
    } catch (error) {
      console.error('[SWManager] Registration failed:', error);
      telemetry.track({
        category: 'service-worker',
        action: 'registration-failed',
        metadata: { error: String(error) },
      });
    }
  }

  /**
   * Handle service worker updates
   */
  private handleUpdate(): void {
    const newWorker = this.registration?.installing;
    
    if (newWorker) {
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          // New service worker activated
          console.log('[SWManager] New service worker activated');
          
          // Notify user about update
          this.notifyUpdate();
        }
      });
    }
  }

  /**
   * Notify user about service worker update
   */
  private notifyUpdate(): void {
    // In a real app, show a toast or banner
    console.log('[SWManager] App update available. Please refresh.');
  }

  /**
   * Handle messages from service worker
   */
  private handleMessage(data: any): void {
    console.log('[SWManager] Message from SW:', data);

    switch (data.type) {
      case 'write-queued':
        this.handleWriteQueued(data);
        break;
      case 'write-completed':
        this.handleWriteCompleted(data);
        break;
      case 'write-failed':
        this.handleWriteFailed(data);
        break;
    }

    // Call registered handlers
    const handler = this.messageHandlers.get(data.type);
    if (handler) {
      handler(data);
    }

    // Track telemetry
    telemetry.track({
      category: 'service-worker',
      action: data.type,
      metadata: data,
    });
  }

  /**
   * Handle write operation queued
   */
  private handleWriteQueued(data: any): void {
    console.log('[SWManager] Write operation queued:', data.operation);
    
    // Update network service queue depth
    networkService.updateQueueDepth(data.queueLength);
  }

  /**
   * Handle write operation completed
   */
  private handleWriteCompleted(data: any): void {
    console.log('[SWManager] Write operation completed:', data.operation);
    
    // Update last sync time
    networkService.updateLastSyncTime();
  }

  /**
   * Handle write operation failed
   */
  private handleWriteFailed(data: any): void {
    console.error('[SWManager] Write operation failed:', data.operation, data.error);
    
    // Track failure
    telemetry.track({
      category: 'service-worker',
      action: 'write-failed',
      metadata: {
        url: data.operation.url,
        error: data.error,
        retries: data.operation.retries,
      },
    });
  }

  /**
   * Register background sync
   */
  private async registerBackgroundSync(): Promise<void> {
    if (!this.registration || !this.syncSupported) return;

    try {
      await (this.registration as any).sync.register('write-queue-sync');
      console.log('[SWManager] Background sync registered');
    } catch (error) {
      console.error('[SWManager] Background sync registration failed:', error);
    }
  }

  /**
   * Trigger manual sync
   */
  async triggerSync(): Promise<void> {
    if (!this.registration?.active) return;

    // Send sync message to service worker
    this.registration.active.postMessage({ type: 'SYNC_NOW' });
    
    console.log('[SWManager] Manual sync triggered');
    
    telemetry.track({
      category: 'service-worker',
      action: 'manual-sync',
    });
  }

  /**
   * Get queue status
   */
  async getQueueStatus(): Promise<QueueStatus | null> {
    if (!this.registration?.active) return null;

    return new Promise((resolve) => {
      const channel = new MessageChannel();
      
      channel.port1.onmessage = (event) => {
        resolve(event.data);
      };
      
      this.registration!.active.postMessage(
        { type: 'GET_QUEUE_STATUS' },
        [channel.port2]
      );
      
      // Timeout after 5 seconds
      setTimeout(() => resolve(null), 5000);
    });
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    if (!this.registration?.active) return;

    this.registration.active.postMessage({ type: 'CLEAR_CACHE' });
    
    console.log('[SWManager] Cache cleared');
    
    telemetry.track({
      category: 'service-worker',
      action: 'cache-cleared',
    });
  }

  /**
   * Clear auth-scoped cache
   */
  async clearAuthCache(userId: string, tenantId?: string): Promise<void> {
    if (!this.registration?.active) return;

    this.registration.active.postMessage({
      type: 'CLEAR_AUTH_CACHE',
      userId,
      tenantId,
    });
    
    console.log('[SWManager] Auth cache cleared for user:', userId);
  }

  /**
   * Register message handler
   */
  onMessage(type: string, handler: (data: any) => void): () => void {
    this.messageHandlers.set(type, handler);
    
    return () => {
      this.messageHandlers.delete(type);
    };
  }

  /**
   * Check if service worker is ready
   */
  isReady(): boolean {
    return this.registration?.active !== undefined;
  }

  /**
   * Get registration
   */
  getRegistration(): ServiceWorkerRegistration | null {
    return this.registration;
  }
}

// Singleton instance
let swManagerInstance: ServiceWorkerManager | null = null;

/**
 * Get service worker manager instance
 */
export function getServiceWorkerManager(): ServiceWorkerManager {
  if (!swManagerInstance) {
    swManagerInstance = new ServiceWorkerManager();
  }
  return swManagerInstance;
}

// Export convenience functions
export const swManager = {
  init: () => getServiceWorkerManager().init(),
  triggerSync: () => getServiceWorkerManager().triggerSync(),
  getQueueStatus: () => getServiceWorkerManager().getQueueStatus(),
  clearCache: () => getServiceWorkerManager().clearCache(),
  clearAuthCache: (userId: string, tenantId?: string) => 
    getServiceWorkerManager().clearAuthCache(userId, tenantId),
  onMessage: (type: string, handler: (data: any) => void) =>
    getServiceWorkerManager().onMessage(type, handler),
  isReady: () => getServiceWorkerManager().isReady(),
};