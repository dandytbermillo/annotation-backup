/**
 * Service Worker - Phase 2: Intelligent Caching + Write Replay
 * Unified Offline Foundation (Option A)
 */

// Constants
const CACHE_VERSION = 'v1';
const CACHE_NAMES = {
  DOCS: `docs-cache-${CACHE_VERSION}`,
  LISTS: `lists-cache-${CACHE_VERSION}`,
};

const CACHE_BUDGETS = {
  DOCS: 50 * 1024 * 1024, // 50MB
  LISTS: 15 * 1024 * 1024, // 15MB
};

const CACHE_TTL = {
  DOCS: 7 * 24 * 60 * 60 * 1000, // 7 days
  LISTS: 24 * 60 * 60 * 1000, // 24 hours
};

// Allowlist for caching (GET only)
const CACHE_ALLOWLIST = [
  /^\/api\/postgres-offline\/documents\/.*/,
  /^\/api\/postgres-offline\/notes.*/,
  /^\/api\/postgres-offline\/panels.*/,
  /^\/api\/search\?.*/,
];

// Never cache these sensitive endpoints
const CACHE_BLOCKLIST = [
  /^\/api\/auth\/.*/,
  /^\/api\/telemetry.*/,
  /^\/api\/health.*/,
  /^\/api\/offline-queue\/.*/,
];

// Write operations queue
let writeQueue = [];
const MAX_BATCH_SIZE = 25;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff

// Install event - set up caches
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker:', CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAMES.DOCS),
      caches.open(CACHE_NAMES.LISTS),
    ]).then(() => {
      console.log('[SW] Caches created:', CACHE_NAMES);
      // Skip waiting to activate immediately
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!Object.values(CACHE_NAMES).includes(cacheName)) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Only handle same-origin requests
  if (url.origin !== location.origin) {
    return;
  }
  
  // Check if URL is in blocklist
  if (CACHE_BLOCKLIST.some(pattern => pattern.test(url.pathname))) {
    return; // Let browser handle normally
  }
  
  // Handle GET requests with caching
  if (request.method === 'GET' && shouldCache(url.pathname)) {
    event.respondWith(handleCachedRequest(request));
  }
  // Handle write operations (POST, PUT, DELETE)
  else if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    event.respondWith(handleWriteRequest(request));
  }
});

// Check if URL should be cached
function shouldCache(pathname) {
  return CACHE_ALLOWLIST.some(pattern => pattern.test(pathname));
}

// Determine which cache to use
function getCacheName(pathname) {
  if (pathname.includes('/documents/')) {
    return CACHE_NAMES.DOCS;
  }
  return CACHE_NAMES.LISTS;
}

// Get TTL for cache type
function getCacheTTL(cacheName) {
  if (cacheName === CACHE_NAMES.DOCS) {
    return CACHE_TTL.DOCS;
  }
  return CACHE_TTL.LISTS;
}

// Handle cached GET requests with stale-while-revalidate
async function handleCachedRequest(request) {
  const cacheName = getCacheName(new URL(request.url).pathname);
  const cache = await caches.open(cacheName);
  
  // Try to get from cache first
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // Check if cache is still valid
    const cachedTime = cachedResponse.headers.get('sw-cached-time');
    const ttl = getCacheTTL(cacheName);
    
    if (cachedTime && Date.now() - parseInt(cachedTime) < ttl) {
      // Return cached response and update in background (stale-while-revalidate)
      updateCache(request, cache);
      return cachedResponse;
    }
  }
  
  // Fetch from network
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Clone response for caching
      const responseToCache = networkResponse.clone();
      
      // Add cache metadata
      const headers = new Headers(responseToCache.headers);
      headers.set('sw-cached-time', Date.now().toString());
      
      const modifiedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers,
      });
      
      // Store in cache (with size enforcement)
      await storageWithBudget(cache, request, modifiedResponse, cacheName);
    }
    
    return networkResponse;
  } catch (error) {
    // If network fails and we have cache, return it (even if stale)
    if (cachedResponse) {
      console.log('[SW] Network failed, returning stale cache');
      return cachedResponse;
    }
    
    // Otherwise return offline response
    return new Response(JSON.stringify({ 
      error: 'Offline', 
      message: 'No cached data available' 
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Update cache in background
async function updateCache(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set('sw-cached-time', Date.now().toString());
      
      const modifiedResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });
      
      await cache.put(request, modifiedResponse);
    }
  } catch (error) {
    console.log('[SW] Background cache update failed:', error);
  }
}

// Store with budget enforcement
async function storageWithBudget(cache, request, response, cacheName) {
  const budget = cacheName === CACHE_NAMES.DOCS ? CACHE_BUDGETS.DOCS : CACHE_BUDGETS.LISTS;
  
  // Estimate current cache size
  if ('estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    
    if (usage > budget) {
      // Implement LRU eviction
      await evictLRU(cache, budget);
    }
  }
  
  await cache.put(request, response);
}

// LRU eviction
async function evictLRU(cache, targetSize) {
  const requests = await cache.keys();
  const entries = [];
  
  for (const request of requests) {
    const response = await cache.match(request);
    const cachedTime = response.headers.get('sw-cached-time');
    entries.push({
      request,
      time: cachedTime ? parseInt(cachedTime) : 0,
    });
  }
  
  // Sort by time (oldest first)
  entries.sort((a, b) => a.time - b.time);
  
  // Delete oldest entries
  const toDelete = Math.floor(entries.length * 0.2); // Delete 20% of entries
  for (let i = 0; i < toDelete; i++) {
    await cache.delete(entries[i].request);
  }
}

// Handle write requests with queuing
async function handleWriteRequest(request) {
  const url = new URL(request.url);
  
  // Clone request for queuing
  const body = await request.clone().text();
  const queuedRequest = {
    url: url.pathname + url.search,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: body,
    timestamp: Date.now(),
    retries: 0,
  };
  
  // Try network first
  try {
    const response = await fetch(request);
    
    // If successful, process any queued writes
    if (response.ok && writeQueue.length > 0) {
      processWriteQueue();
    }
    
    return response;
  } catch (error) {
    // Queue the write operation
    writeQueue.push(queuedRequest);
    
    // Notify clients about queued operation
    await notifyClients({
      type: 'write-queued',
      operation: queuedRequest,
      queueLength: writeQueue.length,
    });
    
    // Return optimistic response
    return new Response(JSON.stringify({
      queued: true,
      queueId: queuedRequest.timestamp,
      message: 'Operation queued for replay when online',
    }), {
      status: 202, // Accepted
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Process queued write operations
async function processWriteQueue() {
  if (writeQueue.length === 0) return;
  
  console.log('[SW] Processing write queue:', writeQueue.length, 'operations');
  
  // Process in batches
  const batch = writeQueue.splice(0, MAX_BATCH_SIZE);
  
  for (const operation of batch) {
    try {
      const response = await fetch(operation.url, {
        method: operation.method,
        headers: operation.headers,
        body: operation.body,
      });
      
      if (!response.ok) {
        // Handle 429 or 5xx with backoff
        if (response.status === 429 || response.status >= 500) {
          operation.retries++;
          if (operation.retries < RETRY_DELAYS.length) {
            // Re-queue with delay
            setTimeout(() => {
              writeQueue.unshift(operation);
              processWriteQueue();
            }, RETRY_DELAYS[operation.retries]);
          } else {
            // Move to dead letter queue
            await notifyClients({
              type: 'write-failed',
              operation: operation,
              error: `Failed after ${operation.retries} retries`,
            });
          }
        }
      } else {
        // Success - notify clients
        await notifyClients({
          type: 'write-completed',
          operation: operation,
        });
      }
    } catch (error) {
      // Network error - re-queue
      operation.retries++;
      if (operation.retries < RETRY_DELAYS.length) {
        writeQueue.unshift(operation);
      } else {
        await notifyClients({
          type: 'write-failed',
          operation: operation,
          error: error.message,
        });
      }
    }
  }
  
  // Continue processing if more items
  if (writeQueue.length > 0) {
    setTimeout(() => processWriteQueue(), 1000);
  }
}

// Notify all clients
async function notifyClients(message) {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage(message);
  });
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  const { data } = event;
  
  switch (data.type) {
    case 'SYNC_NOW':
      // Manual sync trigger
      processWriteQueue();
      break;
      
    case 'GET_QUEUE_STATUS':
      // Return queue status
      event.ports[0].postMessage({
        queueLength: writeQueue.length,
        queue: writeQueue,
      });
      break;
      
    case 'CLEAR_CACHE':
      // Clear all caches (on logout/tenant switch)
      caches.keys().then(names => {
        Promise.all(names.map(name => caches.delete(name)));
      });
      writeQueue = [];
      break;
      
    case 'CLEAR_AUTH_CACHE':
      // Clear auth-specific cache entries
      const { userId, tenantId } = data;
      clearAuthScopedCache(userId, tenantId);
      break;
  }
});

// Clear auth-scoped cache entries
async function clearAuthScopedCache(userId, tenantId) {
  const cacheNames = Object.values(CACHE_NAMES);
  
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    
    for (const request of requests) {
      const url = new URL(request.url);
      // Check if URL contains user/tenant specific data
      if (url.searchParams.get('userId') === userId || 
          url.searchParams.get('tenantId') === tenantId ||
          url.pathname.includes(`/users/${userId}`) ||
          url.pathname.includes(`/tenants/${tenantId}`)) {
        await cache.delete(request);
      }
    }
  }
}

// Background sync event (if supported)
self.addEventListener('sync', (event) => {
  if (event.tag === 'write-queue-sync') {
    event.waitUntil(processWriteQueue());
  }
});

console.log('[SW] Service worker loaded:', CACHE_VERSION);