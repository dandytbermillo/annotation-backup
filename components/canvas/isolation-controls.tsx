"use client"

import React, { useState, useEffect } from 'react'
import { useIsolatedDetails, useIsolationSystem } from '@/lib/isolation/context'
import { Lock, Unlock, AlertTriangle, Activity, Zap } from 'lucide-react'

interface IsolationControlsProps {
  // We'll get these from the isolation context
}

export function IsolationControls() {
  const isolatedDetails = useIsolatedDetails()
  const isolatedComponents = isolatedDetails.filter(d => (d.entry.reason ?? 'auto') === 'auto').map(d => d.id)
  const { enabled, setEnabled, config } = useIsolationSystem()
  const [fps, setFps] = useState(60)

  // Track FPS
  useEffect(() => {
    let frameCount = 0
    let lastTime = performance.now()
    let rafId: number
    
    const measureFPS = (now: number) => {
      frameCount++
      
      if (now >= lastTime + 1000) {
        const currentFps = Math.round((frameCount * 1000) / (now - lastTime))
        setFps(currentFps)
        frameCount = 0
        lastTime = now
      }
      
      rafId = requestAnimationFrame(measureFPS)
    }
    
    rafId = requestAnimationFrame(measureFPS)
    
    return () => cancelAnimationFrame(rafId)
  }, [])
  
  const handleToggleIsolation = () => {
    const debug = (window as any).__isolationDebug
    const newEnabled = !enabled
    if (debug) debug.enable(newEnabled)
    setEnabled(newEnabled)
  }
  
  const handleIsolateUnresponsive = () => {
    // This would normally use heuristics to find slow components
    // For now, we'll just show a message
    console.log('Scanning for unresponsive components...')
  }
  
  const handleRestoreAll = () => {
    const debug = (window as any).__isolationDebug
    if (debug) {
      isolatedComponents.forEach((id: string) => debug.restore(id))
    }
  }
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-semibold text-white">Isolation Control</h3>
        </div>
        <button
          onClick={handleToggleIsolation}
          className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
            enabled 
              ? 'bg-green-600 hover:bg-green-700 text-white' 
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>
      
      {/* Performance Metrics */}
      <div className="bg-gray-800 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-gray-400">Current FPS</span>
          </div>
          <span className={`text-lg font-mono font-bold ${
            fps >= 50 ? 'text-green-400' :
            fps >= 30 ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {fps}
          </span>
        </div>
        
        {/* FPS Bar */}
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ${
              fps >= 50 ? 'bg-green-500' :
              fps >= 30 ? 'bg-yellow-500' :
              'bg-red-500'
            }`}
            style={{ width: `${Math.min(100, (fps / 60) * 100)}%` }}
          />
        </div>
        
        {/* Status */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">
            {fps < 30 ? 'Performance degraded' : 
             fps < 50 ? 'Moderate performance' : 
             'Optimal performance'}
          </span>
          {fps < 30 && enabled && (
            <span className="text-yellow-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Auto-isolation active
            </span>
          )}
        </div>
      </div>
      
      {/* Action Buttons */}
      <div className="space-y-2">
        <button
          onClick={handleIsolateUnresponsive}
          disabled={!enabled || fps >= (config?.minFPS ?? 30)}
          className="w-full px-4 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 
                     disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed
                     text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
        >
          <Lock className="w-4 h-4" />
          Isolate Unresponsive
        </button>
        
        <button
          onClick={handleRestoreAll}
          disabled={isolatedComponents.length === 0}
          className="w-full px-4 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800
                     disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed
                     text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
        >
          <Unlock className="w-4 h-4" />
          Restore All
        </button>
      </div>
      
      {/* Isolated Components List */}
      <div className="bg-gray-800 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-300">Isolated Components</span>
          <span className="text-xs text-gray-500">
            {isolatedComponents.length} / 20
          </span>
        </div>
        
        {isolatedComponents.length > 0 ? (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {isolatedComponents.map(id => (
              <div key={id} className="flex items-center justify-between py-1 px-2 bg-gray-700 rounded text-xs">
                <span className="text-yellow-400 truncate flex-1">{id}</span>
                <button
                  onClick={() => {
                    const debug = (window as any).__isolationDebug
                    if (debug) debug.restore(id)
                  }}
                  className="text-blue-400 hover:text-blue-300 ml-2"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500 text-center py-2">
            No components isolated
          </div>
        )}
      </div>
      
      {/* Settings Preview */}
      <div className="text-xs text-gray-500 space-y-1">
        <div className="flex justify-between">
          <span>Threshold:</span>
          <span className="text-gray-400">{config.minFPS} FPS</span>
        </div>
        <div className="flex justify-between">
          <span>Auto-restore:</span>
          <span className="text-gray-400">After {Math.round(config.restoreDelayMs / 1000)}s</span>
        </div>
        <div className="flex justify-between">
          <span>Max isolated:</span>
          <span className="text-gray-400">{config.maxIsolated} components</span>
        </div>
      </div>
      
      {/* Info */}
      <div className="text-xs text-gray-500 italic p-2 bg-gray-800 rounded">
        <Zap className="w-3 h-3 inline mr-1 text-yellow-500" />
        Components are automatically isolated when they impact performance. 
        Isolated components preserve data while suspended.
      </div>
    </div>
  )
}
