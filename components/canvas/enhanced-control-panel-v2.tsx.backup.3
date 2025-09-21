"use client"

import React, { useState, useRef, useEffect } from 'react'
import { useCanvas } from './canvas-context'
import { X, Settings, Lock, Unlock, Activity, Shield, Zap, Save, Download, Upload, RotateCcw, Eye, EyeOff, Maximize2, Minimize2 } from 'lucide-react'
import { useIsolationSystem, useIsolatedIds, useIsolatedDetails } from '@/lib/isolation/context'

interface EnhancedControlPanelV2Props {
  visible: boolean
  onClose: () => void
  canvasItems: any[]
  onAddComponent?: (type: string) => void
}

export function EnhancedControlPanelV2({ visible, onClose, canvasItems, onAddComponent }: EnhancedControlPanelV2Props) {
  const { state, dispatch } = useCanvas()
  const { enabled: isolationEnabled, setEnabled: setIsolationEnabled, config: isolationConfig } = useIsolationSystem()
  const isolatedIds = useIsolatedIds()
  const [activeTab, setActiveTab] = useState<'canvas' | 'isolation' | 'state'>('canvas')
  const [fps, setFps] = useState<number | null>(null)
  const [memory, setMemory] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // FPS monitoring
  useEffect(() => {
    if (!visible) return
    
    let rafId: number
    let lastTime = performance.now()
    let frames = 0
    const fpsHistory: number[] = []
    
    const measureFps = (now: number) => {
      frames++
      const delta = now - lastTime
      
      if (delta >= 1000) {
        const currentFps = Math.round((frames * 1000) / delta)
        fpsHistory.push(currentFps)
        if (fpsHistory.length > 5) fpsHistory.shift()
        
        const avgFps = Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length)
        setFps(avgFps)
        
        frames = 0
        lastTime = now
      }
      
      rafId = requestAnimationFrame(measureFps)
    }
    
    rafId = requestAnimationFrame(measureFps)
    return () => cancelAnimationFrame(rafId)
  }, [visible])
  
  // Memory monitoring
  useEffect(() => {
    if (!visible) return
    
    const checkMemory = () => {
      // @ts-ignore
      if (performance.memory) {
        const memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576)
        setMemory(memoryMB)
      }
    }
    
    checkMemory()
    const interval = setInterval(checkMemory, 2000)
    return () => clearInterval(interval)
  }, [visible])
  
  if (!visible) return null
  
  const totalComponents = canvasItems.filter(item => item.itemType === 'component').length
  const totalPanels = canvasItems.filter(item => item.itemType === 'panel').length
  const isolatedCount = isolatedIds.length
  
  return (
    <div className="fixed top-20 right-4 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-[1000] 
                    w-[600px] max-h-[500px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Settings className="text-blue-400" size={20} />
          <span className="text-white font-semibold">Control Panel</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>
      
      {/* Always Visible Metrics Bar */}
      <div className="bg-gray-800 border-b border-gray-700 p-3">
        <div className="grid grid-cols-6 gap-4 text-xs">
          {/* FPS */}
          <div className="flex flex-col">
            <span className="text-gray-500 mb-1">FPS</span>
            <span className={`text-lg font-mono font-bold ${
              fps === null ? 'text-gray-500' :
              fps >= 50 ? 'text-green-400' :
              fps >= 30 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {fps ?? 'N/A'}
            </span>
          </div>
          
          {/* Memory */}
          <div className="flex flex-col">
            <span className="text-gray-500 mb-1">Memory</span>
            <span className={`text-lg font-mono font-bold ${
              memory === null ? 'text-gray-500' :
              memory < 100 ? 'text-green-400' : 'text-yellow-400'
            }`}>
              {memory !== null ? `${memory}M` : 'N/A'}
            </span>
          </div>
          
          {/* Components */}
          <div className="flex flex-col">
            <span className="text-gray-500 mb-1">Components</span>
            <span className="text-lg font-mono font-bold text-blue-400">
              {totalComponents}
            </span>
          </div>
          
          {/* Panels */}
          <div className="flex flex-col">
            <span className="text-gray-500 mb-1">Panels</span>
            <span className="text-lg font-mono font-bold text-blue-400">
              {totalPanels}
            </span>
          </div>
          
          {/* Isolated */}
          <div className="flex flex-col">
            <span className="text-gray-500 mb-1">Isolated</span>
            <span className={`text-lg font-mono font-bold ${
              isolatedCount > 0 ? 'text-yellow-400' : 'text-gray-400'
            }`}>
              {isolatedCount}
            </span>
          </div>
          
          {/* Zoom */}
          <div className="flex flex-col">
            <span className="text-gray-500 mb-1">Zoom</span>
            <span className="text-lg font-mono font-bold text-white">
              {Math.round(state.canvasState.zoom * 100)}%
            </span>
          </div>
        </div>
        
        {/* Performance Status Bar */}
        {fps !== null && (
          <div className="mt-2">
            <div className="w-full bg-gray-700 rounded-full h-1 overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${
                  fps >= 50 ? 'bg-green-500' :
                  fps >= 30 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(100, (fps / 60) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
      
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-700">
        {['canvas', 'isolation', 'state'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-gray-800 text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      
      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'canvas' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => {
                  const newZoom = Math.min(state.canvasState.zoom * 1.2, 3)
                  dispatch({ type: 'SET_CANVAS_STATE', payload: { zoom: newZoom } })
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm">
                Zoom In
              </button>
              <button 
                onClick={() => {
                  const newZoom = Math.max(state.canvasState.zoom * 0.8, 0.3)
                  dispatch({ type: 'SET_CANVAS_STATE', payload: { zoom: newZoom } })
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm">
                Zoom Out
              </button>
              <button 
                onClick={() => {
                  dispatch({ 
                    type: 'SET_CANVAS_STATE', 
                    payload: { zoom: 1, translateX: -1000, translateY: -1200 } 
                  })
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm">
                Reset View
              </button>
              <button 
                onClick={() => {
                  dispatch({ 
                    type: 'SET_CANVAS_STATE', 
                    payload: { showConnections: !state.canvasState.showConnections } 
                  })
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm">
                Toggle Connections
              </button>
            </div>
          </div>
        )}
        
        {activeTab === 'isolation' && (
          <div className="space-y-4">
            {/* Isolation Toggle */}
            <div className="flex items-center justify-between p-3 bg-gray-800 rounded">
              <span className="text-white">Isolation System</span>
              <button
                onClick={() => setIsolationEnabled(!isolationEnabled)}
                className={`px-3 py-1 rounded text-xs font-medium ${
                  isolationEnabled ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'
                }`}
              >
                {isolationEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            
            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  const debug = (window as any).__isolationDebug
                  if (!debug) return
                  
                  const components = canvasItems.filter(item => item.itemType === 'component')
                  const panels = canvasItems.filter(item => item.itemType === 'panel' && item.panelId !== 'main')
                  const allItems = [...components, ...panels]
                  
                  if (allItems.length > 0 && debug.attempt) {
                    const result = debug.attempt()
                    console.table([{
                      Action: 'Isolate Unresponsive',
                      Result: result ? 'Success' : 'No candidates',
                      Time: new Date().toLocaleTimeString()
                    }])
                  }
                }}
                disabled={!isolationEnabled || fps === null || fps >= isolationConfig.minFPS}
                className="px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-white text-sm flex items-center justify-center gap-2"
              >
                <Lock size={16} />
                Isolate Unresponsive
              </button>
              
              <button
                onClick={() => {
                  const debug = (window as any).__isolationDebug
                  if (debug) {
                    isolatedIds.forEach(id => debug.restore(id))
                    console.table([{
                      Action: 'Restore All',
                      Count: isolatedIds.length,
                      Time: new Date().toLocaleTimeString()
                    }])
                  }
                }}
                disabled={isolatedCount === 0}
                className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-white text-sm flex items-center justify-center gap-2"
              >
                <Unlock size={16} />
                Restore All
              </button>
            </div>
            
            {/* Isolated Components List */}
            {isolatedCount > 0 && (
              <div className="bg-gray-800 rounded p-3">
                <div className="text-sm text-gray-400 mb-2">Isolated Components</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {isolatedIds.map(id => (
                    <div key={id} className="flex items-center justify-between py-1 px-2 bg-gray-700 rounded text-xs">
                      <span className="text-yellow-400">{id}</span>
                      <button
                        onClick={() => {
                          const debug = (window as any).__isolationDebug
                          if (debug) debug.restore(id)
                        }}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Settings */}
            <div className="bg-gray-800 rounded p-3 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Threshold:</span>
                <span className="text-white">{isolationConfig.minFPS} FPS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Auto-restore:</span>
                <span className="text-white">After {isolationConfig.restoreDelayMs / 1000}s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Max isolated:</span>
                <span className="text-white">{isolationConfig.maxIsolated}</span>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'state' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => {
                  const stateToSave = {
                    panels: Array.from(state.panels.entries()),
                    canvasState: state.canvasState,
                    canvasItems,
                    timestamp: new Date().toISOString()
                  }
                  localStorage.setItem('canvas-state', JSON.stringify(stateToSave))
                  console.table([{ Action: 'State Saved', Time: new Date().toLocaleTimeString() }])
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm flex items-center justify-center gap-2">
                <Save size={16} />
                Save State
              </button>
              <button 
                onClick={() => {
                  const savedState = localStorage.getItem('canvas-state')
                  if (savedState) {
                    const parsed = JSON.parse(savedState)
                    console.table([{ 
                      Action: 'State Loaded', 
                      Panels: parsed.panels?.length || 0,
                      Time: new Date().toLocaleTimeString() 
                    }])
                  }
                }}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-white text-sm flex items-center justify-center gap-2">
                <RotateCcw size={16} />
                Reload State
              </button>
              <button 
                onClick={() => {
                  const stateToExport = {
                    panels: Array.from(state.panels.entries()),
                    canvasState: state.canvasState,
                    canvasItems,
                    timestamp: new Date().toISOString()
                  }
                  const blob = new Blob([JSON.stringify(stateToExport, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `canvas-state-${Date.now()}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white text-sm flex items-center justify-center gap-2">
                <Download size={16} />
                Export
              </button>
              <label className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-white text-sm flex items-center justify-center gap-2 cursor-pointer">
                <Upload size={16} />
                Import
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      const reader = new FileReader()
                      reader.onload = (event) => {
                        try {
                          const imported = JSON.parse(event.target?.result as string)
                          console.table([{ 
                            Action: 'State Imported', 
                            Panels: imported.panels?.length || 0,
                            Time: new Date().toLocaleTimeString() 
                          }])
                        } catch (error) {
                          console.error('Failed to import state:', error)
                        }
                      }
                      reader.readAsText(file)
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}