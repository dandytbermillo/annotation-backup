/**
 * Cache Manager for Unified Offline Foundation
 * 
 * Manages Service Worker Cache Storage with:
 * - TTL enforcement
 * - LRU eviction
 * - Size budgets
 * - Auth-aware cache keys
 */

import { telemetry } from './telemetry';
import { getFeatureFlag } from './feature-flags';

interface CacheConfig {
  name: string;
  version: number;
  maxSizeBytes: number;
  ttlMs: number;
  maxEntries?: number;
}

interface CacheEntry {
  url: string;
  timestamp: number;
  size: number;
  userId?: string;
}

const CACHE_CONFIGS: Record<string, CacheConfig> = {
  docs: {
    name: 'docs-cache',
    version: 1,
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    maxEntries: 1000,
  },
  lists: {
    name: 'lists-cache',
    version: 1,
    maxSizeBytes: 15 * 1024 * 1024, // 15MB
    ttlMs: 24 * 60 * 60 * 1000, // 24 hours
    maxEntries: 500,
  },
  search: {
    name: 'search-cache',
    version: 1,
    maxSizeBytes: 15 * 1024 * 1024, // 15MB
    ttlMs: 24 * 60 * 60 * 1000, // 24 hours
    maxEntries: 200,
  },
};

export class CacheManager {
  private entries: Map<string, CacheEntry[]> = new Map();
  private currentUserId?: string;

  constructor() {
    // Initialize entry tracking for each cache
    Object.keys(CACHE_CONFIGS).forEach(key => {
      this.entries.set(key, []);
    });
  }

  /**
   * Set current user ID for auth-aware caching
   */
  setUserId(userId: string | undefined): void {
    this.currentUserId = userId;
  }

  /**
   * Get cache name with version
   */
  private getCacheName(namespace: string): string {
    const config = CACHE_CONFIGS[namespace];
    if (!config) throw new Error(`Unknown cache namespace: ${namespace}`);
    return `${config.name}-v${config.version}`;
  }

  /**
   * Get cache key with auth scope
   */
  private getCacheKey(url: string, userId?: string): string {
    const uid = userId || this.currentUserId;
    return uid ? `${uid}:${url}` : url;
  }

  /**
   * Cache a response
   */
  async put(
    namespace: string,
    url: string,
    response: Response
  ): Promise<void> {
    if (!getFeatureFlag('offline.swCaching')) {
      return; // Feature disabled
    }

    if (!('caches' in self)) {
      return; // Cache API not available
    }

    const config = CACHE_CONFIGS[namespace];
    if (!config) {
      console.error(`Unknown cache namespace: ${namespace}`);
      return;
    }

    try {
      const cacheName = this.getCacheName(namespace);
      const cache = await caches.open(cacheName);
      
      // Clone response for size calculation
      const clonedResponse = response.clone();
      const blob = await clonedResponse.blob();
      const size = blob.size;

      // Check size budget
      const currentSize = await this.getCacheSize(namespace);
      if (currentSize + size > config.maxSizeBytes) {
        // Need to evict
        await this.evictLRU(namespace, size);
      }

      // Cache with auth-aware key
      const cacheKey = this.getCacheKey(url, this.currentUserId);
      await cache.put(cacheKey, response);

      // Track entry
      this.addEntry(namespace, {
        url: cacheKey,
        timestamp: Date.now(),
        size,
        userId: this.currentUserId,
      });

      // Track metrics
      telemetry.trackCache(namespace, {
        sizeBytes: currentSize + size,
      });
    } catch (error) {
      console.error(`Cache put error (${namespace}):`, error);
    }
  }

  /**
   * Get from cache
   */
  async get(
    namespace: string,
    url: string
  ): Promise<Response | undefined> {
    if (!getFeatureFlag('offline.swCaching')) {
      return undefined; // Feature disabled
    }

    if (!('caches' in self)) {
      return undefined; // Cache API not available
    }

    try {
      const cacheName = this.getCacheName(namespace);
      const cache = await caches.open(cacheName);
      
      // Try with auth-aware key first
      const cacheKey = this.getCacheKey(url, this.currentUserId);
      let response = await cache.match(cacheKey);

      if (!response) {
        // Try without auth scope as fallback
        response = await cache.match(url);
      }

      if (response) {
        // Check TTL
        const entry = this.findEntry(namespace, cacheKey) || 
                      this.findEntry(namespace, url);
        
        if (entry) {
          const config = CACHE_CONFIGS[namespace];
          const age = Date.now() - entry.timestamp;
          
          if (age > config.ttlMs) {
            // Expired, delete and return undefined
            await cache.delete(cacheKey);
            this.removeEntry(namespace, cacheKey);
            
            telemetry.trackCache(namespace, {
              misses: 1,
            });
            
            return undefined;
          }
        }

        // Cache hit
        telemetry.trackCache(namespace, {
          hits: 1,
        });

        return response;
      }

      // Cache miss
      telemetry.trackCache(namespace, {
        misses: 1,
      });

      return undefined;
    } catch (error) {
      console.error(`Cache get error (${namespace}):`, error);
      return undefined;
    }
  }

  /**
   * Delete from cache
   */
  async delete(namespace: string, url: string): Promise<boolean> {
    if (!('caches' in self)) {
      return false;
    }

    try {
      const cacheName = this.getCacheName(namespace);
      const cache = await caches.open(cacheName);
      
      const cacheKey = this.getCacheKey(url, this.currentUserId);
      const deleted = await cache.delete(cacheKey);
      
      if (deleted) {
        this.removeEntry(namespace, cacheKey);
      }
      
      return deleted;
    } catch (error) {
      console.error(`Cache delete error (${namespace}):`, error);
      return false;
    }
  }

  /**
   * Clear all caches for a namespace
   */
  async clear(namespace?: string): Promise<void> {
    if (!('caches' in self)) {
      return;
    }

    try {
      if (namespace) {
        // Clear specific namespace
        const cacheName = this.getCacheName(namespace);
        await caches.delete(cacheName);
        this.entries.set(namespace, []);
      } else {
        // Clear all namespaces
        for (const ns of Object.keys(CACHE_CONFIGS)) {
          const cacheName = this.getCacheName(ns);
          await caches.delete(cacheName);
          this.entries.set(ns, []);
        }
      }
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }

  /**
   * Clear caches for a specific user
   */
  async clearUserCaches(userId: string): Promise<void> {
    if (!('caches' in self)) {
      return;
    }

    for (const namespace of Object.keys(CACHE_CONFIGS)) {
      const cacheName = this.getCacheName(namespace);
      const cache = await caches.open(cacheName);
      
      // Get entries for this user
      const userEntries = this.entries.get(namespace)?.filter(
        e => e.userId === userId
      ) || [];
      
      // Delete each entry
      for (const entry of userEntries) {
        await cache.delete(entry.url);
      }
      
      // Remove from tracking
      const remaining = this.entries.get(namespace)?.filter(
        e => e.userId !== userId
      ) || [];
      this.entries.set(namespace, remaining);
    }
  }

  /**
   * Get cache size for namespace
   */
  private async getCacheSize(namespace: string): Promise<number> {
    const entries = this.entries.get(namespace) || [];
    return entries.reduce((sum, entry) => sum + entry.size, 0);
  }

  /**
   * Evict LRU entries to make space
   */
  private async evictLRU(
    namespace: string,
    requiredSpace: number
  ): Promise<void> {
    const config = CACHE_CONFIGS[namespace];
    const entries = this.entries.get(namespace) || [];
    
    // Sort by timestamp (oldest first)
    entries.sort((a, b) => a.timestamp - b.timestamp);
    
    const cacheName = this.getCacheName(namespace);
    const cache = await caches.open(cacheName);
    
    let freedSpace = 0;
    const toRemove: CacheEntry[] = [];
    
    for (const entry of entries) {
      if (freedSpace >= requiredSpace) break;
      
      await cache.delete(entry.url);
      freedSpace += entry.size;
      toRemove.push(entry);
    }
    
    // Remove from tracking
    const remaining = entries.filter(e => !toRemove.includes(e));
    this.entries.set(namespace, remaining);
    
    // Track evictions
    telemetry.trackCache(namespace, {
      evictions: toRemove.length,
    });
  }

  /**
   * Add entry to tracking
   */
  private addEntry(namespace: string, entry: CacheEntry): void {
    const entries = this.entries.get(namespace) || [];
    entries.push(entry);
    
    // Enforce max entries
    const config = CACHE_CONFIGS[namespace];
    if (config.maxEntries && entries.length > config.maxEntries) {
      entries.shift(); // Remove oldest
    }
    
    this.entries.set(namespace, entries);
  }

  /**
   * Find entry in tracking
   */
  private findEntry(
    namespace: string,
    url: string
  ): CacheEntry | undefined {
    const entries = this.entries.get(namespace) || [];
    return entries.find(e => e.url === url);
  }

  /**
   * Remove entry from tracking
   */
  private removeEntry(namespace: string, url: string): void {
    const entries = this.entries.get(namespace) || [];
    const filtered = entries.filter(e => e.url !== url);
    this.entries.set(namespace, filtered);
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<Record<string, {
    entries: number;
    sizeBytes: number;
    oldestEntry?: number;
  }>> {
    const stats: Record<string, any> = {};
    
    for (const namespace of Object.keys(CACHE_CONFIGS)) {
      const entries = this.entries.get(namespace) || [];
      const sizeBytes = entries.reduce((sum, e) => sum + e.size, 0);
      const oldestEntry = entries.length > 0 
        ? Math.min(...entries.map(e => e.timestamp))
        : undefined;
      
      stats[namespace] = {
        entries: entries.length,
        sizeBytes,
        oldestEntry,
      };
    }
    
    return stats;
  }
}

// Singleton instance
let cacheManagerInstance: CacheManager | null = null;

/**
 * Get cache manager instance
 */
export function getCacheManager(): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager();
  }
  return cacheManagerInstance;
}

// Export convenience functions
export const cacheManager = {
  put: (namespace: string, url: string, response: Response) =>
    getCacheManager().put(namespace, url, response),
  get: (namespace: string, url: string) =>
    getCacheManager().get(namespace, url),
  delete: (namespace: string, url: string) =>
    getCacheManager().delete(namespace, url),
  clear: (namespace?: string) =>
    getCacheManager().clear(namespace),
  clearUserCaches: (userId: string) =>
    getCacheManager().clearUserCaches(userId),
  setUserId: (userId: string | undefined) =>
    getCacheManager().setUserId(userId),
  getStats: () =>
    getCacheManager().getStats(),
};