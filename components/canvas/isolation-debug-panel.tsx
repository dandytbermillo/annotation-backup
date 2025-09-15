"use client"

import React, { useEffect, useState } from 'react'
import { useIsolatedIds, useIsolationSystem } from '@/lib/isolation/context'
import { Bug, Activity, Lock, Unlock, Zap } from 'lucide-react'

export function IsolationDebugPanel() {
  const isolatedIds = useIsolatedIds()
  const { enabled, setEnabled } = useIsolationSystem()
  const [fps, setFps] = useState<number>(60)
  const [debugInfo, setDebugInfo] = useState<any>({})
  
  useEffect(() => {
    const interval = setInterval(() => {
      const debug = (window as any).__isolationDebug
      if (debug) {
        setFps(debug.getFps())
        setDebugInfo({
          list: debug.list(),
          enabled: enabled
        })
      }
    }, 500)
    
    return () => clearInterval(interval)
  }, [enabled])
  
  const handleTestIsolate = () => {
    const debug = (window as any).__isolationDebug
    if (debug) {
      // Try to isolate a test component
      debug.isolate('test-component-' + Date.now())
      console.table([{
        Action: 'Test Isolate',
        Time: new Date().toLocaleTimeString(),
        List: debug.list().join(', ') || 'None'
      }])
    }
  }
  
  const handleForceIsolate = () => {
    const debug = (window as any).__isolationDebug
    if (debug) {
      const result = debug.attempt()
      console.table([{
        Action: 'Force Attempt',
        Result: result ? 'Success' : 'Failed',
        Time: new Date().toLocaleTimeString(),
        List: debug.list().join(', ') || 'None'
      }])
    }
  }
  
  const handleClearAll = () => {
    const debug = (window as any).__isolationDebug
    if (debug) {
      const list = debug.list()
      list.forEach(id => debug.restore(id))
      console.table([{
        Action: 'Clear All',
        Cleared: list.length + ' components',
        Time: new Date().toLocaleTimeString()
      }])
    }
  }
  
  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 border border-gray-700 rounded-lg p-4 shadow-2xl z-[9999] max-w-sm">
      <div className="flex items-center gap-2 mb-3">
        <Bug className="text-yellow-400" size={20} />
        <span className="text-white font-bold">Isolation Debug</span>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`ml-auto px-2 py-1 rounded text-xs ${
            enabled ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      
      <div className="space-y-2 text-xs">
        {/* FPS Monitor */}
        <div className="flex items-center justify-between">
          <span className="text-gray-400">FPS:</span>
          <span className={`font-mono ${
            fps < 30 ? 'text-red-400' : fps < 50 ? 'text-yellow-400' : 'text-green-400'
          }`}>
            {fps.toFixed(1)}
          </span>
        </div>
        
        {/* Isolated Count */}
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Isolated:</span>
          <span className="text-white font-mono">{isolatedIds.length}</span>
        </div>
        
        {/* Isolated List */}
        {isolatedIds.length > 0 && (
          <div className="mt-2 p-2 bg-gray-800 rounded">
            <div className="text-gray-400 mb-1">Active Isolations:</div>
            {isolatedIds.map(id => (
              <div key={id} className="text-yellow-300 text-xs truncate">
                • {id}
              </div>
            ))}
          </div>
        )}
        
        {/* Debug Actions */}
        <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-gray-700">
          <button
            onClick={handleTestIsolate}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
            title="Create a test isolation"
          >
            <Lock size={12} className="inline mr-1" />
            Test
          </button>
          <button
            onClick={handleForceIsolate}
            className="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs"
            title="Force isolate heaviest component"
          >
            <Zap size={12} className="inline mr-1" />
            Force
          </button>
          <button
            onClick={handleClearAll}
            className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
            title="Clear all isolations"
          >
            <Unlock size={12} className="inline mr-1" />
            Clear
          </button>
        </div>
        
        {/* Raw Debug Info */}
        {debugInfo.list && debugInfo.list.length > 0 && (
          <div className="mt-2 p-2 bg-black rounded text-xs">
            <div className="text-gray-500">Raw List:</div>
            <pre className="text-green-400 overflow-x-auto">
              {JSON.stringify(debugInfo.list, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}