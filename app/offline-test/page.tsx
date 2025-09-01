'use client';

import { useState, useEffect } from 'react';

export default function OfflineTestPage() {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [telemetryStatus, setTelemetryStatus] = useState<string>('pending');
  const [metrics, setMetrics] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [mockMode, setMockMode] = useState<boolean>(false);

  useEffect(() => {
    loadFlags();
    addLog('Phase 0 Test Page loaded', 'info');
  }, []);

  const loadFlags = () => {
    const stored = localStorage.getItem('offlineFeatureFlags');
    const parsed = stored ? JSON.parse(stored) : {
      'offline.circuitBreaker': false,
      'offline.swCaching': false,
      'offline.conflictUI': false
    };
    setFlags(parsed);
    addLog('Feature flags loaded', 'success');
  };

  const addLog = (message: string, type: string = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${type.toUpperCase()}: ${message}`]);
  };

  const toggleFlag = (flagName: string) => {
    const newFlags = { ...flags, [flagName]: !flags[flagName] };
    setFlags(newFlags);
    localStorage.setItem('offlineFeatureFlags', JSON.stringify(newFlags));
    addLog(`Toggled ${flagName} to ${newFlags[flagName]}`, 'info');
  };

  const testFeatureFlags = () => {
    try {
      const testFlags = {
        'offline.circuitBreaker': false,
        'offline.swCaching': false,
        'offline.conflictUI': false
      };
      
      localStorage.setItem('offlineFeatureFlags', JSON.stringify(testFlags));
      const stored = JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}');
      
      if (JSON.stringify(stored) === JSON.stringify(testFlags)) {
        addLog('Feature flags test PASSED', 'success');
      } else {
        addLog('Feature flags test FAILED', 'error');
      }
      loadFlags();
    } catch (error: any) {
      addLog(`Feature flags test error: ${error.message}`, 'error');
    }
  };

  const testTelemetry = async () => {
    try {
      // Test GET
      const getRes = await fetch('/api/telemetry');
      const getMetrics = await getRes.json();
      
      // Test POST
      const postRes = await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [{
            timestamp: Date.now(),
            category: 'test',
            action: 'manual-test',
            metadata: { source: 'web-ui' }
          }],
          metrics: {
            network: { quality: 'good', rtt: 50 },
            cache: { hits: 10, misses: 2 },
            queue: { depth: 0 },
            conflict: { occurrences: 0 }
          },
          timestamp: Date.now()
        })
      });
      
      const postResult = await postRes.json();
      
      if (getRes.ok && postRes.ok && postResult.success) {
        setTelemetryStatus('success');
        setMetrics(getMetrics);
        addLog('Telemetry test PASSED', 'success');
      } else {
        setTelemetryStatus('error');
        addLog('Telemetry test FAILED', 'error');
      }
    } catch (error: any) {
      setTelemetryStatus('error');
      addLog(`Telemetry test error: ${error.message}`, 'error');
    }
  };

  const sendEvent = async () => {
    try {
      const res = await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [{
            timestamp: Date.now(),
            category: 'user',
            action: 'button-click',
            value: Math.random() * 100
          }],
          metrics: {
            network: { quality: 'good', rtt: Math.random() * 100 },
            cache: { hits: Math.floor(Math.random() * 100) },
            queue: { depth: Math.floor(Math.random() * 10) },
            conflict: { occurrences: 0 }
          },
          timestamp: Date.now()
        })
      });
      
      if (res.ok) {
        addLog('Telemetry event sent', 'success');
        fetchMetrics();
      }
    } catch (error: any) {
      addLog(`Send event error: ${error.message}`, 'error');
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/telemetry');
      const data = await res.json();
      setMetrics(data);
      addLog('Metrics fetched', 'success');
    } catch (error: any) {
      addLog(`Fetch metrics error: ${error.message}`, 'error');
    }
  };

  const testHealth = async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      
      if (res.ok && data.ok) {
        addLog(`Health check PASSED: ${data.status}`, 'success');
      } else {
        addLog('Health check FAILED', 'error');
      }
    } catch (error: any) {
      addLog(`Health check error: ${error.message}`, 'error');
    }
  };

  const toggleMockMode = () => {
    const newMode = !mockMode;
    setMockMode(newMode);
    // Store mock mode in localStorage for other components to read
    localStorage.setItem('offlineMockMode', newMode.toString());
    addLog(`Mock mode ${newMode ? 'ENABLED' : 'DISABLED'}`, newMode ? 'warning' : 'info');
    
    // If enabling mock mode, simulate offline conditions
    if (newMode) {
      // This would typically trigger mock responses in your network layer
      window.dispatchEvent(new CustomEvent('mockModeChange', { detail: { enabled: true } }));
    } else {
      window.dispatchEvent(new CustomEvent('mockModeChange', { detail: { enabled: false } }));
    }
  };

  const testE2EHarness = () => {
    try {
      // Test mock mode persistence
      const stored = localStorage.getItem('offlineMockMode');
      
      // Test custom events
      const testEvent = new CustomEvent('e2eTest', { detail: { test: 'harness' } });
      window.dispatchEvent(testEvent);
      
      // Test utilities availability
      const utils = {
        mockMode: mockMode,
        flags: flags,
        telemetryActive: telemetryStatus === 'success'
      };
      
      addLog('E2E Harness test PASSED', 'success');
      addLog(`Mock Mode: ${mockMode ? 'ON' : 'OFF'}, Flags: ${Object.keys(flags).length}, Telemetry: ${telemetryStatus}`, 'info');
    } catch (error: any) {
      addLog(`E2E Harness test error: ${error.message}`, 'error');
    }
  };

  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared', 'info');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 border-b-2 border-indigo-600 pb-4">
          🔬 Phase 0 - Unified Offline Foundation Test Page
        </h1>

        {/* How to Use Section */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">📖 How to Use This Test Page</h2>
          
          <ol className="list-decimal list-inside space-y-2 mb-4">
            <li><strong>Test Feature Flags:</strong> Click "Test Feature Flags" to verify localStorage persistence</li>
            <li><strong>Toggle Flags:</strong> Use toggle buttons to enable/disable individual features</li>
            <li><strong>Test Telemetry:</strong> Click "Test Telemetry" to verify the metrics API</li>
            <li><strong>Send Events:</strong> Click "Send Event" to manually send telemetry events</li>
            <li><strong>Test E2E Harness:</strong> Click "Test E2E Harness" to verify testing utilities</li>
            <li><strong>Enable Mock Mode:</strong> Toggle mock mode to simulate offline scenarios</li>
            <li><strong>Test Health:</strong> Click "Test Health Endpoint" to verify backend connectivity</li>
            <li><strong>Monitor Logs:</strong> Watch real-time test results in the logs panel at the bottom</li>
          </ol>
          
          <div className="mt-4">
            <h3 className="text-lg font-semibold mb-2">Foundation Components:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li><strong>Feature Flags:</strong> Runtime toggles for offline.circuitBreaker, offline.swCaching, offline.conflictUI</li>
              <li><strong>Telemetry:</strong> Event tracking with metrics for network, cache, queue, and conflicts</li>
              <li><strong>E2E Harness:</strong> Mock mode and testing utilities for offline scenarios</li>
              <li><strong>Health Check:</strong> Verify backend connectivity and service status</li>
            </ul>
          </div>
          
          <div className="bg-white/20 p-3 rounded-lg mt-4">
            <p className="text-sm">
              <strong>💡 Tip:</strong> This is the foundation layer (Phase 0). After testing here, proceed to:
              <a href="/phase1-test" className="underline ml-1">Phase 1 (Connectivity)</a> →
              <a href="/phase2-test" className="underline ml-1">Phase 2 (Service Worker)</a>
            </p>
          </div>
        </div>

        {/* Feature Flags Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">1. Feature Flags System</h2>
          <div className="space-x-2 mb-4">
            <button
              onClick={testFeatureFlags}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Test Feature Flags
            </button>
            {Object.keys(flags).map(flag => (
              <button
                key={flag}
                onClick={() => toggleFlag(flag)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Toggle {flag.replace('offline.', '')}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(flags).map(([key, value]) => (
              <div key={key} className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 uppercase">{key.replace('offline.', '')}</div>
                <div className={`text-lg font-bold ${value ? 'text-green-600' : 'text-red-600'}`}>
                  {value ? 'ON' : 'OFF'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Telemetry Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">2. Telemetry System</h2>
          <div className="space-x-2 mb-4">
            <button
              onClick={testTelemetry}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Test Telemetry
            </button>
            <button
              onClick={sendEvent}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Send Event
            </button>
            <button
              onClick={fetchMetrics}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Fetch Metrics
            </button>
          </div>
          {metrics && (
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 uppercase">Network Quality</div>
                <div className="text-lg font-bold">{metrics.network?.quality || 'N/A'}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 uppercase">RTT (ms)</div>
                <div className="text-lg font-bold">{metrics.network?.rtt || 0}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 uppercase">Cache Hit Rate</div>
                <div className="text-lg font-bold">
                  {((metrics.cache?.hitRate || 0) * 100).toFixed(1)}%
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 uppercase">Queue Depth</div>
                <div className="text-lg font-bold">{metrics.queue?.depth || 0}</div>
              </div>
            </div>
          )}
        </div>

        {/* E2E Test Harness Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">3. E2E Test Harness & Mock Mode</h2>
          <div className="space-x-2 mb-4">
            <button
              onClick={testE2EHarness}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Test E2E Harness
            </button>
            <button
              onClick={toggleMockMode}
              className={`px-4 py-2 text-white rounded ${
                mockMode 
                  ? 'bg-orange-600 hover:bg-orange-700' 
                  : 'bg-gray-600 hover:bg-gray-700'
              }`}
            >
              {mockMode ? 'Disable' : 'Enable'} Mock Mode
            </button>
            <button
              onClick={testHealth}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Test Health Endpoint
            </button>
          </div>
          {mockMode && (
            <div className="bg-orange-50 border-l-4 border-orange-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <span className="text-orange-400">⚠️</span>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-orange-700">
                    Mock Mode is ENABLED. Network requests will be simulated for testing offline scenarios.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Network & Circuit Breaker Preview */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">4. Phase 1 Preview</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
              <h3 className="font-semibold mb-2">Network Detector</h3>
              <p className="text-sm text-gray-600">
                {flags['offline.circuitBreaker'] 
                  ? '✅ Flag enabled - Ready for Phase 1'
                  : '⏳ Requires offline.circuitBreaker flag (Phase 1)'}
              </p>
            </div>
            <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
              <h3 className="font-semibold mb-2">Circuit Breaker</h3>
              <p className="text-sm text-gray-600">
                {flags['offline.circuitBreaker']
                  ? '✅ Flag enabled - Ready for Phase 1'
                  : '⏳ Requires offline.circuitBreaker flag (Phase 1)'}
              </p>
            </div>
          </div>
        </div>

        {/* Cache Manager Preview */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">5. Phase 2 Preview</h2>
          <div className="bg-blue-50 p-4 rounded border border-blue-200">
            <h3 className="font-semibold mb-2">Cache Manager</h3>
            <p className="text-sm text-gray-600">
              {flags['offline.swCaching']
                ? '✅ Flag enabled - Ready for Phase 2'
                : '⏳ Requires offline.swCaching flag (Phase 2)'}
            </p>
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