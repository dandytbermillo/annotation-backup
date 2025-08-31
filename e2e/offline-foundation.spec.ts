import { test, expect } from '@playwright/test';
import { createOfflineContext } from './utils/offline-test-utils';

/**
 * E2E Tests for Unified Offline Foundation
 * Phase 0: Foundation verification
 */

test.describe('Phase 0: Foundation', () => {
  test('feature flags are accessible', async ({ page, context }) => {
    const utils = await createOfflineContext(page, context);
    
    await page.goto('/');
    
    // Check that feature flags are defined
    const flags = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}');
    });
    
    expect(flags).toBeDefined();
    
    // Enable a flag and verify
    await utils.enableFeatureFlag('offline.circuitBreaker');
    const enabledFlags = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}');
    });
    
    expect(enabledFlags['offline.circuitBreaker']).toBe(true);
    
    // Disable and verify
    await utils.disableFeatureFlag('offline.circuitBreaker');
    const disabledFlags = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}');
    });
    
    expect(disabledFlags['offline.circuitBreaker']).toBe(false);
  });

  test('telemetry endpoint is accessible', async ({ page }) => {
    const response = await page.request.get('/api/telemetry');
    expect(response.ok()).toBe(true);
    
    const metrics = await response.json();
    expect(metrics).toHaveProperty('network');
    expect(metrics).toHaveProperty('cache');
    expect(metrics).toHaveProperty('queue');
    expect(metrics).toHaveProperty('conflict');
  });

  test('can go offline and online', async ({ page, context }) => {
    const utils = await createOfflineContext(page, context);
    
    await page.goto('/');
    
    // Check initial online state
    const initialOnline = await page.evaluate(() => navigator.onLine);
    expect(initialOnline).toBe(true);
    
    // Go offline
    await utils.goOffline();
    const offlineState = await page.evaluate(() => navigator.onLine);
    expect(offlineState).toBe(false);
    
    // Go back online
    await utils.goOnline();
    const onlineState = await page.evaluate(() => navigator.onLine);
    expect(onlineState).toBe(true);
  });

  test('can clear caches', async ({ page, context }) => {
    const utils = await createOfflineContext(page, context);
    
    await page.goto('/');
    
    // Create a test cache
    await page.evaluate(async () => {
      const cache = await caches.open('test-cache');
      await cache.put('/test', new Response('test data'));
    });
    
    // Verify cache exists
    let cacheStats = await utils.getCacheStats();
    expect(cacheStats.cacheNames).toContain('test-cache');
    
    // Clear caches
    await utils.clearCaches();
    
    // Verify cache is cleared
    cacheStats = await utils.getCacheStats();
    expect(cacheStats.cacheNames).not.toContain('test-cache');
  });
});

test.describe('Service Worker Registration', () => {
  test.skip('can register service worker', async ({ page, context }) => {
    // Skip until SW is implemented in Phase 2
    const utils = await createOfflineContext(page, context);
    
    await page.goto('/');
    await utils.registerServiceWorker();
    
    const swRegistered = await page.evaluate(() => {
      return 'serviceWorker' in navigator && 
             navigator.serviceWorker.controller !== null;
    });
    
    expect(swRegistered).toBe(true);
  });
});