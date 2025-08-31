'use client';

import { useState, useEffect } from 'react';
import { ConnectivityBadge } from '@/components/offline/connectivity-badge';
import { NetworkStatus, networkService } from '@/lib/offline/network-service';
import { getFeatureFlag } from '@/lib/offline/feature-flags';

export default function Phase1TestPage() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);
  const [circuitBreakerEnabled, setCircuitBreakerEnabled] = useState(false);
  const [healthData, setHealthData] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [probeCount, setProbeCount] = useState(0);
  const [failureSimulation, setFailureSimulation] = useState(false);

  useEffect(() => {
    // Check feature flag
    const flagEnabled = getFeatureFlag('offline.circuitBreaker');
    setCircuitBreakerEnabled(flagEnabled);
    
    if (flagEnabled) {
      // Subscribe to network status changes
      const unsubscribe = networkService.onStatusChange((status) => {
        setNetworkStatus(status);
        addLog(`Network status: ${status.quality}, Circuit: ${status.circuitState}, RTT: ${status.rtt}ms`);
      });

      // Start the network service
      networkService.start();
      addLog('Network service started', 'success');

      return () => {
        unsubscribe();
      };
    } else {
      addLog('Circuit breaker flag disabled - enable it to test Phase 1 features', 'warning');
    }
  }, []);

  const addLog = (message: string, type: string = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
    setLogs(prev => [...prev, logEntry]);
  };

  const toggleCircuitBreaker = () => {
    const newValue = !circuitBreakerEnabled;
    localStorage.setItem('offlineFeatureFlags', JSON.stringify({
      ...JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}'),
      'offline.circuitBreaker': newValue
    }));
    addLog(`Circuit breaker flag toggled to ${newValue}. Reload page to apply.`, 'warning');
  };

  const testHealthEndpoint = async () => {
    try {
      const startTime = Date.now();
      const response = await fetch('/api/health');
      const data = await response.json();
      const responseTime = Date.now() - startTime;
      
      setHealthData(data);
      addLog(`Health check: ${data.status}, DB: ${data.database?.connected ? 'Connected' : 'Disconnected'}, Response: ${responseTime}ms`, 'success');
    } catch (error: any) {
      addLog(`Health check failed: ${error.message}`, 'error');
    }
  };

  const testHealthHead = async () => {
    try {
      const startTime = Date.now();
      const response = await fetch('/api/health', { method: 'HEAD' });
      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        addLog(`HEAD health check: OK, Response: ${responseTime}ms`, 'success');
      } else {
        addLog(`HEAD health check: ${response.status} ${response.statusText}`, 'error');
      }
    } catch (error: any) {
      addLog(`HEAD health check failed: ${error.message}`, 'error');
    }
  };

  const forceProbe = async () => {
    if (!circuitBreakerEnabled) {
      addLog('Enable circuit breaker flag first', 'warning');
      return;
    }
    
    addLog('Forcing network probe...', 'info');
    const quality = await networkService.probe();
    setProbeCount(prev => prev + 1);
    addLog(`Probe complete: ${quality}`, quality === 'good' ? 'success' : 'warning');
  };

  const simulateFailures = () => {
    if (!circuitBreakerEnabled) {
      addLog('Enable circuit breaker flag first', 'warning');
      return;
    }
    
    setFailureSimulation(true);
    addLog('Simulating network failures...', 'warning');
    
    // Force circuit open after 3 failures
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        networkService.forceCircuitOpen();
        addLog(`Failure ${i + 1}/3 - Circuit will open`, 'error');
      }, i * 1000);
    }
    
    setTimeout(() => {
      addLog('Circuit should now be OPEN', 'error');
      setFailureSimulation(false);
    }, 3500);
  };

  const resetCircuit = () => {
    if (!circuitBreakerEnabled) {
      addLog('Enable circuit breaker flag first', 'warning');
      return;
    }
    
    networkService.forceCircuitClosed();
    addLog('Circuit reset to CLOSED', 'success');
  };

  const updateQueueDepth = (depth: number) => {
    networkService.updateQueueDepth(depth);
    addLog(`Queue depth updated to ${depth}`, 'info');
  };

  const getCircuitStats = () => {
    if (!circuitBreakerEnabled) {
      addLog('Enable circuit breaker flag first', 'warning');
      return;
    }
    
    const stats = networkService.getCircuitStats();
    addLog(`Circuit stats - Failures: ${stats.failureCount}, Success: ${stats.successCount}, Backoff: ${stats.currentBackoff}ms`, 'info');
  };

  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared', 'info');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header with Connectivity Badge */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 border-b-2 border-blue-600 pb-4">
            ⚡ Phase 1 - Connectivity Foundation Test
          </h1>
          <ConnectivityBadge />
        </div>

        {/* How to Use Section */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">📖 How to Use This Test Page</h2>
          
          <ol className="list-decimal list-inside space-y-2 mb-4">
            <li><strong>Start the dev server:</strong> Run <code className="bg-white/20 px-2 py-1 rounded">npm run dev</code> in your terminal</li>
            <li><strong>Enable Circuit Breaker:</strong> Click "Toggle Flag" below, then refresh the page</li>
            <li><strong>Quick Test:</strong> Use the test buttons in each section for manual testing</li>
            <li><strong>Monitor Status:</strong> Watch the real-time network status badge in the top-right corner</li>
          </ol>
          
          <div className="mt-4">
            <h3 className="text-lg font-semibold mb-2">Test Scenarios:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li><strong>Network Status:</strong> Real-time connectivity monitoring with RTT and quality metrics</li>
              <li><strong>Health Checks:</strong> Test GET/HEAD endpoints to verify backend connectivity</li>
              <li><strong>Network Service:</strong> Force probes, simulate failures, and reset circuit breaker</li>
              <li><strong>Queue Management:</strong> Update queue depth and sync time</li>
              <li><strong>Circuit Stats:</strong> View failure count, success count, and backoff timing</li>
            </ul>
          </div>
          
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => {
                localStorage.setItem('offlineFeatureFlags', JSON.stringify({'offline.circuitBreaker': true}));
                setTimeout(() => window.location.reload(), 100);
              }}
              className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg border-2 border-white font-semibold"
            >
              ⚡ Quick Setup: Enable & Reload
            </button>
            <button
              onClick={async () => {
                await testHealthEndpoint();
                await testHealthHead();
                await forceProbe();
                getCircuitStats();
                addLog('Quick test suite completed!', 'success');
              }}
              className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg border-2 border-white font-semibold"
            >
              🚀 Run Quick Tests
            </button>
          </div>
        </div>

        {/* Feature Flag Status */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Feature Flag Status</h2>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-gray-700">offline.circuitBreaker: </span>
              <span className={`font-bold ${circuitBreakerEnabled ? 'text-green-600' : 'text-red-600'}`}>
                {circuitBreakerEnabled ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            <button
              onClick={toggleCircuitBreaker}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Toggle Flag (Requires Reload)
            </button>
          </div>
        </div>

        {/* Network Status */}
        {networkStatus && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Network Status</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm text-gray-500 uppercase">Quality</div>
                <div className={`text-lg font-bold ${
                  networkStatus.quality === 'good' ? 'text-green-600' :
                  networkStatus.quality === 'degraded' ? 'text-yellow-600' :
                  'text-red-600'
                }`}>
                  {networkStatus.quality.toUpperCase()}
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm text-gray-500 uppercase">Circuit State</div>
                <div className={`text-lg font-bold ${
                  networkStatus.circuitState === 'closed' ? 'text-green-600' :
                  networkStatus.circuitState === 'half-open' ? 'text-yellow-600' :
                  'text-red-600'
                }`}>
                  {networkStatus.circuitState.toUpperCase()}
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm text-gray-500 uppercase">RTT</div>
                <div className="text-lg font-bold">
                  {networkStatus.rtt > 0 ? `${Math.round(networkStatus.rtt)}ms` : 'N/A'}
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm text-gray-500 uppercase">Queue Depth</div>
                <div className="text-lg font-bold">{networkStatus.queueDepth}</div>
              </div>
            </div>
          </div>
        )}

        {/* Health Endpoint Tests */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Health Endpoint Tests</h2>
          <div className="space-x-2 mb-4">
            <button
              onClick={testHealthEndpoint}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Test GET
            </button>
            <button
              onClick={testHealthHead}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Test HEAD
            </button>
          </div>
          {healthData && (
            <div className="bg-gray-50 p-4 rounded">
              <pre className="text-xs overflow-x-auto">
                {JSON.stringify(healthData, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Network Service Controls */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Network Service Controls</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <button
              onClick={forceProbe}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Force Probe ({probeCount})
            </button>
            <button
              onClick={simulateFailures}
              disabled={failureSimulation}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:bg-gray-400"
            >
              Simulate Failures
            </button>
            <button
              onClick={resetCircuit}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Reset Circuit
            </button>
            <button
              onClick={() => updateQueueDepth(Math.floor(Math.random() * 20))}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Random Queue Depth
            </button>
            <button
              onClick={getCircuitStats}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Get Circuit Stats
            </button>
            <button
              onClick={() => networkService.updateLastSyncTime()}
              className="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700"
            >
              Update Sync Time
            </button>
          </div>
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
      </div>
    </div>
  );
}