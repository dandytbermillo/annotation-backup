'use client';

import { useState, useEffect } from 'react';
import { swManager } from '@/lib/offline/service-worker-manager';
import { getFeatureFlag } from '@/lib/offline/feature-flags';
import { ReplayProgress } from '@/components/offline/replay-progress';
import { PWAInstallPrompt } from '@/components/offline/pwa-install-prompt';

export default function Phase2TestPage() {
  const [swStatus, setSwStatus] = useState<string>('checking');
  const [cacheStatus, setCacheStatus] = useState<any>(null);
  const [queueStatus, setQueueStatus] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [flagEnabled, setFlagEnabled] = useState(false);

  useEffect(() => {
    checkServiceWorker();
    checkFeatureFlag();
  }, []);

  const checkFeatureFlag = () => {
    const enabled = getFeatureFlag('offline.swCaching');
    setFlagEnabled(enabled);
    if (!enabled) {
      addLog('Service Worker caching disabled - enable flag to test', 'warning');
    }
  };

  const checkServiceWorker = async () => {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        setSwStatus('registered');
        addLog('Service Worker registered', 'success');
        
        if (registration.active) {
          addLog('Service Worker active', 'success');
        }
        
        // Check for updates
        registration.addEventListener('updatefound', () => {
          addLog('New Service Worker available', 'info');
        });
      } else {
        setSwStatus('not-registered');
        addLog('Service Worker not registered', 'warning');
      }
    } else {
      setSwStatus('not-supported');
      addLog('Service Workers not supported', 'error');
    }
  };

  const addLog = (message: string, type: string = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${type.toUpperCase()}: ${message}`]);
  };

  const enableSWCaching = () => {
    localStorage.setItem('offlineFeatureFlags', JSON.stringify({
      ...JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}'),
      'offline.swCaching': true
    }));
    addLog('SW Caching flag enabled - reload to apply', 'success');
  };

  const registerServiceWorker = async () => {
    if (!flagEnabled) {
      addLog('Enable SW caching flag first', 'warning');
      return;
    }
    
    try {
      await swManager.init();
      addLog('Service Worker initialization started', 'success');
      checkServiceWorker();
    } catch (error: any) {
      addLog(`SW registration failed: ${error.message}`, 'error');
    }
  };

  const checkCacheStatus = async () => {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      const cacheInfo: any = {};
      
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        cacheInfo[name] = {
          entries: keys.length,
          urls: keys.slice(0, 5).map(req => new URL(req.url).pathname)
        };
      }
      
      setCacheStatus(cacheInfo);
      addLog(`Found ${cacheNames.length} caches`, 'info');
    } else {
      addLog('Cache API not available', 'error');
    }
  };

  const checkQueueStatus = async () => {
    try {
      const response = await fetch('/api/offline-queue/status');
      const data = await response.json();
      setQueueStatus(data);
      
      // Safely access total with fallback
      const total = data?.summary?.total || 0;
      addLog(`Queue status: ${total} total operations`, 'info');
    } catch (error: any) {
      addLog(`Failed to fetch queue status: ${error.message}`, 'error');
      setQueueStatus(null);
    }
  };

  const seedTestData = async () => {
    addLog('Seeding test data...', 'info');
    
    try {
      // Note: In production, this would be a server-side script
      // For testing, we'll create some sample data via API calls
      
      // Create test notes
      for (let i = 1; i <= 3; i++) {
        await fetch('/api/postgres-offline/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `sw-test-note-${i}`,
            title: `SW Test Note ${i}`,
            content: `Content for service worker cache test ${i}`,
          })
        });
      }
      
      addLog('Test data seeded successfully', 'success');
    } catch (error: any) {
      addLog(`Seeding failed: ${error.message}`, 'error');
    }
  };

  const testCacheHit = async () => {
    addLog('Testing cache hit...', 'info');
    
    try {
      // First request - should cache
      const start1 = Date.now();
      const response1 = await fetch('/api/postgres-offline/notes');
      const time1 = Date.now() - start1;
      addLog(`First request: ${time1}ms (cached)`, 'success');
      
      // Second request - should hit cache
      const start2 = Date.now();
      const response2 = await fetch('/api/postgres-offline/notes');
      const time2 = Date.now() - start2;
      addLog(`Second request: ${time2}ms (${time2 < time1 / 2 ? 'cache hit!' : 'cache miss'})`, 
        time2 < time1 / 2 ? 'success' : 'warning');
    } catch (error: any) {
      addLog(`Cache test failed: ${error.message}`, 'error');
    }
  };

  const testOfflineWrite = async () => {
    addLog('Testing offline write...', 'info');
    
    try {
      // Simulate offline by using a failing endpoint
      const response = await fetch('/api/postgres-offline/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Offline Write Test',
          content: 'This should be queued',
        })
      });
      
      if (response.status === 202) {
        const data = await response.json();
        addLog(`Write queued: ${data.queueId}`, 'success');
      } else {
        addLog('Write completed normally', 'info');
      }
    } catch (error: any) {
      addLog(`Write test error: ${error.message}`, 'error');
    }
  };

  const triggerSync = async () => {
    addLog('Triggering manual sync...', 'info');
    await swManager.triggerSync();
    addLog('Sync triggered', 'success');
  };

  const clearAllCaches = async () => {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
      addLog('All caches cleared', 'success');
      setCacheStatus(null);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared', 'info');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-900 border-b-2 border-purple-600 pb-4 mb-8">
          🚀 Phase 2 - Service Worker Caching + Write Replay Test
        </h1>

        {/* How to Use */}
        <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">📖 How to Use This Test Page</h2>
          
          <ol className="list-decimal list-inside space-y-2 mb-4">
            <li><strong>Enable SW Caching:</strong> Click "Enable SW Caching" and refresh</li>
            <li><strong>Register Service Worker:</strong> Click "Register SW" to initialize</li>
            <li><strong>Seed Test Data:</strong> Create sample data for testing</li>
            <li><strong>Test Cache Hit:</strong> Verify caching is working</li>
            <li><strong>Test Offline Write:</strong> Queue operations when offline</li>
            <li><strong>Check Status:</strong> Monitor cache and queue status</li>
          </ol>
          
          <div className="flex gap-3">
            <button
              onClick={() => {
                enableSWCaching();
                setTimeout(() => window.location.reload(), 100);
              }}
              className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg border-2 border-white font-semibold"
            >
              ⚡ Quick Setup: Enable & Reload
            </button>
          </div>
        </div>

        {/* Service Worker Status */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Service Worker Status</h2>
          
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-gray-700">Status: </span>
              <span className={`font-bold ${
                swStatus === 'registered' ? 'text-green-600' :
                swStatus === 'not-registered' ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {swStatus.toUpperCase()}
              </span>
            </div>
            <div>
              <span className="text-gray-700">offline.swCaching: </span>
              <span className={`font-bold ${flagEnabled ? 'text-green-600' : 'text-red-600'}`}>
                {flagEnabled ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={enableSWCaching}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Enable SW Caching
            </button>
            <button
              onClick={registerServiceWorker}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Register SW
            </button>
            <button
              onClick={checkServiceWorker}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Check Status
            </button>
          </div>
        </div>

        {/* Cache Testing */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Cache Testing</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <button
              onClick={seedTestData}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Seed Test Data
            </button>
            <button
              onClick={testCacheHit}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Test Cache Hit
            </button>
            <button
              onClick={checkCacheStatus}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Check Caches
            </button>
            <button
              onClick={clearAllCaches}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Clear Caches
            </button>
          </div>
          
          {cacheStatus && (
            <div className="bg-gray-50 p-4 rounded">
              <h3 className="font-semibold mb-2">Cache Contents:</h3>
              {Object.entries(cacheStatus).map(([name, info]: [string, any]) => (
                <div key={name} className="mb-2">
                  <div className="font-medium">{name}: {info.entries} entries</div>
                  <ul className="text-sm text-gray-600 ml-4">
                    {info.urls.map((url: string) => (
                      <li key={url}>• {url}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Write Replay Testing */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Write Replay Testing</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <button
              onClick={testOfflineWrite}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
            >
              Test Offline Write
            </button>
            <button
              onClick={triggerSync}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Trigger Sync
            </button>
            <button
              onClick={checkQueueStatus}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Check Queue
            </button>
          </div>
          
          {queueStatus && (
            <div className="bg-gray-50 p-4 rounded">
              <h3 className="font-semibold mb-2">Queue Status:</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div>Total: {queueStatus?.summary?.total || 0}</div>
                <div>Pending: {queueStatus?.summary?.byStatus?.pending?.count || 0}</div>
                <div>Failed: {queueStatus?.summary?.byStatus?.failed?.count || 0}</div>
              </div>
              {queueStatus?.failedOperations?.length > 0 && (
                <div className="mt-2">
                  <div className="text-sm font-medium text-red-600">Failed Operations:</div>
                  {queueStatus.failedOperations.slice(0, 3).map((op: any) => (
                    <div key={op.id} className="text-sm text-gray-600">
                      • {op.method} {op.url} (retries: {op.retryCount})
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Test Logs */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Test Logs</h2>
            <button
              onClick={clearLogs}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Clear Logs
            </button>
          </div>
          <div className="bg-gray-900 text-gray-300 p-4 rounded font-mono text-sm h-64 overflow-y-auto">
            {logs.map((log, i) => (
              <div 
                key={i} 
                className={
                  log.includes('SUCCESS') ? 'text-green-400' :
                  log.includes('ERROR') ? 'text-red-400' :
                  log.includes('WARNING') ? 'text-yellow-400' :
                  log.includes('INFO') ? 'text-blue-400' :
                  ''
                }
              >
                {log}
              </div>
            ))}
          </div>
        </div>

        {/* Components */}
        <ReplayProgress />
        <PWAInstallPrompt />
      </div>
    </div>
  );
}