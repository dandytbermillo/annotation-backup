import { Page, BrowserContext, expect } from '@playwright/test';

/**
 * E2E Test Utilities for Offline Testing
 * Provides helpers for Service Worker, cache, and network simulation
 */

export class OfflineTestUtils {
  constructor(
    private page: Page,
    private context: BrowserContext
  ) {}

  /**
   * Wait for Service Worker to be ready
   */
  async waitForServiceWorker(): Promise<void> {
    await this.page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
  }

  /**
   * Register and activate Service Worker
   */
  async registerServiceWorker(swPath = '/sw.js'): Promise<void> {
    await this.page.evaluate(async (path) => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.register(path);
        await registration.update();
      }
    }, swPath);
    await this.waitForServiceWorker();
  }

  /**
   * Go offline
   */
  async goOffline(): Promise<void> {
    await this.context.setOffline(true);
    // Also set navigator.onLine for consistency
    await this.page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });
      window.dispatchEvent(new Event('offline'));
    });
  }

  /**
   * Go online
   */
  async goOnline(): Promise<void> {
    await this.context.setOffline(false);
    await this.page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });
  }

  /**
   * Simulate flaky network
   */
  async simulateFlakyNetwork(
    errorRate = 0.3,
    delayMs = 1000
  ): Promise<void> {
    await this.page.route('**/*', async (route) => {
      // Randomly fail requests
      if (Math.random() < errorRate) {
        await route.abort('failed');
      } else {
        // Add delay
        await new Promise(resolve => setTimeout(resolve, delayMs));
        await route.continue();
      }
    });
  }

  /**
   * Clear all caches
   */
  async clearCaches(): Promise<void> {
    await this.page.evaluate(async () => {
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(name => caches.delete(name)));
      }
    });
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    cacheNames: string[];
    totalEntries: number;
    sizes: Record<string, number>;
  }> {
    return await this.page.evaluate(async () => {
      if (!('caches' in window)) {
        return { cacheNames: [], totalEntries: 0, sizes: {} };
      }

      const names = await caches.keys();
      let totalEntries = 0;
      const sizes: Record<string, number> = {};

      for (const name of names) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        totalEntries += keys.length;
        
        // Estimate size (simplified)
        let cacheSize = 0;
        for (const request of keys) {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            cacheSize += blob.size;
          }
        }
        sizes[name] = cacheSize;
      }

      return { cacheNames: names, totalEntries, sizes };
    });
  }

  /**
   * Check if a URL is cached
   */
  async isCached(url: string): Promise<boolean> {
    return await this.page.evaluate(async (testUrl) => {
      if (!('caches' in window)) return false;
      
      const names = await caches.keys();
      for (const name of names) {
        const cache = await caches.open(name);
        const response = await cache.match(testUrl);
        if (response) return true;
      }
      return false;
    }, url);
  }

  /**
   * Get network quality indicator
   */
  async getNetworkQuality(): Promise<'good' | 'degraded' | 'offline'> {
    return await this.page.evaluate(() => {
      // This would be implemented by the network detector
      return (window as any).networkQuality || 'good';
    });
  }

  /**
   * Get circuit breaker state
   */
  async getCircuitBreakerState(): Promise<'closed' | 'open' | 'half-open'> {
    return await this.page.evaluate(() => {
      // This would be implemented by the circuit breaker
      return (window as any).circuitBreakerState || 'closed';
    });
  }

  /**
   * Get queue depth
   */
  async getQueueDepth(): Promise<number> {
    return await this.page.evaluate(() => {
      // Get from localStorage or window object
      const queue = localStorage.getItem('offlineQueue');
      if (queue) {
        try {
          return JSON.parse(queue).length;
        } catch {}
      }
      return 0;
    });
  }

  /**
   * Wait for sync to complete
   */
  async waitForSync(timeoutMs = 10000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const queue = localStorage.getItem('offlineQueue');
        if (!queue) return true;
        try {
          return JSON.parse(queue).length === 0;
        } catch {
          return true;
        }
      },
      { timeout: timeoutMs }
    );
  }

  /**
   * Enable feature flag
   */
  async enableFeatureFlag(flag: string): Promise<void> {
    await this.page.evaluate((flagName) => {
      const flags = JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}');
      flags[flagName] = true;
      localStorage.setItem('offlineFeatureFlags', JSON.stringify(flags));
    }, flag);
    // Reload to apply flag
    await this.page.reload();
  }

  /**
   * Disable feature flag
   */
  async disableFeatureFlag(flag: string): Promise<void> {
    await this.page.evaluate((flagName) => {
      const flags = JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}');
      flags[flagName] = false;
      localStorage.setItem('offlineFeatureFlags', JSON.stringify(flags));
    }, flag);
    await this.page.reload();
  }

  /**
   * Create test document
   */
  async createTestDocument(
    noteId = 'test-note',
    panelId = 'test-panel',
    content = { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
  ): Promise<void> {
    await this.page.evaluate(async ({ nId, pId, cont }) => {
      await fetch('/api/postgres-offline/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: nId,
          panelId: pId,
          content: cont,
        }),
      });
    }, { nId: noteId, pId: panelId, cont: content });
  }

  /**
   * Assert cache hit for URL
   */
  async assertCacheHit(url: string): Promise<void> {
    const isCached = await this.isCached(url);
    expect(isCached).toBe(true);
  }

  /**
   * Assert queue is empty
   */
  async assertQueueEmpty(): Promise<void> {
    const depth = await this.getQueueDepth();
    expect(depth).toBe(0);
  }

  /**
   * Get telemetry metrics
   */
  async getTelemetryMetrics(): Promise<any> {
    return await this.page.evaluate(() => {
      return (window as any).telemetryMetrics || {};
    });
  }
}

/**
 * Create offline test context
 */
export async function createOfflineContext(
  page: Page,
  context: BrowserContext
): Promise<OfflineTestUtils> {
  return new OfflineTestUtils(page, context);
}