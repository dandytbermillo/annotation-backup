'use client';

import { useState, useEffect } from 'react';

interface DebugLog {
  id: number;
  timestamp: string;
  component: string;
  action: string;
  content_preview: string;
  metadata: any;
  session_id: string;
}

export default function DebugPage() {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState('');

  const fetchLogs = async () => {
    try {
      const response = await fetch('/api/debug/log');
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    }
  };

  useEffect(() => {
    fetchLogs();
    
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 2000); // Refresh every 2 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const clearLogs = async () => {
    try {
      const response = await fetch('/api/debug/clear', { method: 'POST' });
      if (response.ok) {
        fetchLogs();
      }
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  };

  const filteredLogs = logs.filter(log => 
    !filter || 
    log.component.toLowerCase().includes(filter.toLowerCase()) ||
    log.action.toLowerCase().includes(filter.toLowerCase()) ||
    log.content_preview?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">🔍 Debug Logs Viewer</h1>
        
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex gap-4 items-center">
            <button
              onClick={fetchLogs}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
            >
              Refresh
            </button>
            
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-refresh (2s)
            </label>
            
            <input
              type="text"
              placeholder="Filter logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-3 py-2 bg-gray-700 rounded flex-1"
            />
            
            <button
              onClick={clearLogs}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded"
            >
              Clear All
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {filteredLogs.length === 0 ? (
            <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
              No logs found. Try interacting with the application.
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="text-xs text-gray-500 w-32">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-1 bg-blue-900 rounded text-xs">
                        {log.component}
                      </span>
                      <span className="px-2 py-1 bg-green-900 rounded text-xs">
                        {log.action}
                      </span>
                    </div>
                    
                    {log.content_preview && (
                      <div className="text-sm text-gray-300 mb-2">
                        {log.content_preview}
                      </div>
                    )}
                    
                    {log.metadata && (
                      <details className="cursor-pointer">
                        <summary className="text-xs text-gray-500 hover:text-gray-300">
                          View metadata
                        </summary>
                        <pre className="mt-2 p-2 bg-gray-900 rounded text-xs overflow-x-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                  
                  <div className="text-xs text-gray-600">
                    #{log.id}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="mt-8 bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-2">📊 What to Look For</h2>
          <ul className="space-y-1 text-sm text-gray-400">
            <li>• <strong>LayerProvider → updateTransform</strong>: Shows when layer transforms are updated</li>
            <li>• <strong>NotesExplorer → panning</strong>: Shows mouse drag events and which layer is being panned</li>
            <li>• <strong>PopupOverlay → render</strong>: Shows the current transform being applied to popups</li>
          </ul>
        </div>
      </div>
    </div>
  );
}