'use client';

import { useState, useEffect } from 'react';

export default function OfflineTestPage() {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [telemetryStatus, setTelemetryStatus] = useState<string>('pending');
  const [metrics, setMetrics] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);

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

        {/* Health Check Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">3. Health Check</h2>
          <button
            onClick={testHealth}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Test Health Endpoint
          </button>
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