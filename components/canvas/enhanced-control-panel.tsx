"use client"

import React, { useState, useRef, useEffect } from 'react'
import { useCanvas } from './canvas-context'
import { X, Plus, Hand, ZoomIn, ZoomOut, RotateCcw, Layers, Lock, Unlock, 
         Trash2, Save, Download, Upload, Settings, Activity, MousePointer,
         Move, Box, FileText, Timer, Calculator, TestTube, Shield, ShieldOff } from 'lucide-react'

interface ControlPanelProps {
  visible?: boolean
  onClose?: () => void
}

export function EnhancedControlPanel({ visible = true, onClose }: ControlPanelProps) {
  const { state, dispatch, dataStore } = useCanvas()
  const [activeTab, setActiveTab] = useState<'canvas' | 'isolation' | 'state'>('canvas')
  const [selectionMode, setSelectionMode] = useState<'single' | 'multi'>('single')
  const [isolatedComponents, setIsolatedComponents] = useState<Set<string>>(new Set())
  const [performanceMetrics, setPerformanceMetrics] = useState({
    fps: 60,
    memory: 45,
    headlessActive: 0
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Get panel statistics
  const totalPanels = state.panels.size
  const selectedPanels = Array.from(state.panels.values()).filter(p => p.selected).length
  const isolatedCount = isolatedComponents.size

  // Monitor FPS
  useEffect(() => {
    if (!visible) return
    
    let frameCount = 0
    let lastTime = performance.now()
    let animationId: number
    
    const measureFPS = () => {
      frameCount++
      const currentTime = performance.now()
      
      if (currentTime >= lastTime + 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime))
        setPerformanceMetrics(prev => ({ ...prev, fps }))
        frameCount = 0
        lastTime = currentTime
      }
      
      animationId = requestAnimationFrame(measureFPS)
    }
    
    animationId = requestAnimationFrame(measureFPS)
    
    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [visible])

  // Monitor Memory (if available)
  useEffect(() => {
    if (!visible) return
    
    const updateMemory = () => {
      // @ts-ignore - performance.memory is not standard but available in Chrome
      if (performance.memory) {
        const memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576)
        setPerformanceMetrics(prev => ({ ...prev, memory: memoryMB }))
      }
    }
    
    updateMemory()
    const interval = setInterval(updateMemory, 2000)
    
    return () => clearInterval(interval)
  }, [visible])

  // Canvas control functions
  const handleZoomIn = () => {
    const newZoom = Math.min(state.canvasState.zoom * 1.2, 3)
    dispatch({ type: 'SET_CANVAS_STATE', payload: { zoom: newZoom } })
  }

  const handleZoomOut = () => {
    const newZoom = Math.max(state.canvasState.zoom * 0.8, 0.3)
    dispatch({ type: 'SET_CANVAS_STATE', payload: { zoom: newZoom } })
  }

  const handleResetView = () => {
    dispatch({ 
      type: 'SET_CANVAS_STATE', 
      payload: { 
        zoom: 1, 
        translateX: -1000, 
        translateY: -1200 
      } 
    })
  }

  const handleTogglePanMode = () => {
    // Toggle between pan mode and select mode
    dispatch({ 
      type: 'SET_CANVAS_STATE', 
      payload: { 
        isPanMode: !state.canvasState.isPanMode 
      } 
    })
  }

  const handleAddComponent = (type: 'calculator' | 'timer' | 'editor' | 'dragtest') => {
    const panelId = `${type}-${Date.now()}`
    const randomOffset = {
      x: Math.random() * 200 - 100,
      y: Math.random() * 200 - 100
    }
    
    const newPanel = {
      id: panelId,
      type: type as any,
      title: type.charAt(0).toUpperCase() + type.slice(1),
      position: { 
        x: 2200 + randomOffset.x, 
        y: 1600 + randomOffset.y 
      },
      dimensions: { width: 350, height: 300 },
      isEditable: type === 'editor',
      selected: false,
      isolated: false,
      branches: []
    }
    
    dispatch({ 
      type: 'ADD_PANEL', 
      payload: { 
        id: panelId, 
        panel: newPanel 
      } 
    })
  }

  const handleSelectAll = () => {
    const updatedPanels = new Map(state.panels)
    updatedPanels.forEach((panel) => {
      panel.selected = true
    })
    dispatch({ type: 'SET_PANELS', payload: updatedPanels })
  }

  const handleClearSelection = () => {
    const updatedPanels = new Map(state.panels)
    updatedPanels.forEach((panel) => {
      panel.selected = false
    })
    dispatch({ type: 'SET_PANELS', payload: updatedPanels })
  }

  const handleDeleteSelected = () => {
    const selectedIds = Array.from(state.panels.entries())
      .filter(([_, panel]) => panel.selected)
      .map(([id, _]) => id)
    
    selectedIds.forEach(id => {
      if (id !== 'main') { // Don't delete main panel
        dispatch({ type: 'REMOVE_PANEL', payload: { id } })
      }
    })
  }

  const handleIsolateUnresponsive = () => {
    // Simulate isolating unresponsive components
    const newIsolated = new Set(isolatedComponents)
    state.panels.forEach((panel, id) => {
      if (panel.selected) {
        newIsolated.add(id)
        panel.isolated = true
      }
    })
    setIsolatedComponents(newIsolated)
  }

  const handleUnisolateAll = () => {
    state.panels.forEach((panel) => {
      panel.isolated = false
    })
    setIsolatedComponents(new Set())
  }

  const handleSaveState = () => {
    const stateToSave = {
      panels: Array.from(state.panels.entries()),
      canvasState: state.canvasState,
      timestamp: new Date().toISOString()
    }
    localStorage.setItem('canvas-state', JSON.stringify(stateToSave))
    console.log('State saved to localStorage')
  }

  const handleLoadState = () => {
    const savedState = localStorage.getItem('canvas-state')
    if (savedState) {
      const parsed = JSON.parse(savedState)
      const panelsMap = new Map(parsed.panels)
      dispatch({ type: 'SET_PANELS', payload: panelsMap })
      dispatch({ type: 'SET_CANVAS_STATE', payload: parsed.canvasState })
      console.log('State loaded from localStorage')
    }
  }

  const handleExportState = () => {
    const stateToExport = {
      panels: Array.from(state.panels.entries()),
      canvasState: state.canvasState,
      timestamp: new Date().toISOString()
    }
    
    const blob = new Blob([JSON.stringify(stateToExport, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `canvas-state-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportState = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target?.result as string)
          const panelsMap = new Map(imported.panels)
          dispatch({ type: 'SET_PANELS', payload: panelsMap })
          dispatch({ type: 'SET_CANVAS_STATE', payload: imported.canvasState })
          console.log('State imported successfully')
        } catch (error) {
          console.error('Failed to import state:', error)
        }
      }
      reader.readAsText(file)
    }
  }

  if (!visible) return null

  return (
    <div className="fixed top-4 left-4 z-[1000] w-80 bg-gray-900 text-white rounded-lg shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
        <h2 className="text-lg font-semibold">Control Panel</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-gray-800/50 px-4 py-3 text-xs space-y-1 border-b border-gray-700">
        <h3 className="text-yellow-400 font-semibold mb-1">Multi-Select Canvas</h3>
        <p className="text-gray-300">• Drag components by title bar</p>
        <p className="text-yellow-300">• Hold Shift + drag to select multiple</p>
        <p className="text-gray-300">• Shift + click component to add to selection</p>
        <p className="text-gray-300">• Ctrl + click component to toggle selection</p>
        <p className="text-gray-300">• Auto-scroll when dragging near edges</p>
        <p className="text-gray-300">• Drag empty areas to pan canvas</p>
        <p className="text-gray-300">• Mouse wheel to zoom</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('canvas')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'canvas' 
              ? 'bg-gray-700 text-white border-b-2 border-blue-500' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Canvas Controls
        </button>
        <button
          onClick={() => setActiveTab('isolation')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'isolation' 
              ? 'bg-gray-700 text-white border-b-2 border-blue-500' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Isolation
        </button>
        <button
          onClick={() => setActiveTab('state')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'state' 
              ? 'bg-gray-700 text-white border-b-2 border-blue-500' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          State
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto">
        {activeTab === 'canvas' && (
          <>
            {/* Add Components */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Add Components</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleAddComponent('calculator')}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
                >
                  <Calculator size={16} />
                  Add Calculator
                </button>
                <button
                  onClick={() => handleAddComponent('timer')}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors"
                >
                  <Timer size={16} />
                  Add Timer
                </button>
                <button
                  onClick={() => handleAddComponent('editor')}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm transition-colors"
                >
                  <FileText size={16} />
                  Add Editor
                </button>
                <button
                  onClick={() => handleAddComponent('dragtest')}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm transition-colors"
                >
                  <TestTube size={16} />
                  Add Drag Test
                </button>
              </div>
            </div>

            {/* Selection Controls */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">
                Selection {selectedPanels > 0 && `(${selectedPanels} selected)`}
              </h3>
              <div className="space-y-2">
                <button
                  onClick={handleSelectAll}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
                >
                  <Box size={16} />
                  Select All
                </button>
                <button
                  onClick={handleClearSelection}
                  disabled={selectedPanels === 0}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm transition-colors"
                >
                  <X size={16} />
                  Clear Selection
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedPanels === 0}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition-colors"
                >
                  <Trash2 size={16} />
                  Delete Selected
                </button>
              </div>
            </div>

            {/* Zoom Controls */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">View Controls</h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={handleZoomIn}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
                  >
                    <ZoomIn size={16} />
                    Zoom In
                  </button>
                  <button
                    onClick={handleZoomOut}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
                  >
                    <ZoomOut size={16} />
                    Zoom Out
                  </button>
                </div>
                <button
                  onClick={handleResetView}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
                >
                  <RotateCcw size={16} />
                  Reset View
                </button>
                <div className="text-center py-2 bg-gray-800 rounded text-sm">
                  Zoom: {Math.round(state.canvasState.zoom * 100)}%
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'isolation' && (
          <>
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300 flex items-center gap-2">
                <Lock size={16} />
                Isolation Controls
              </h3>
              <div className="space-y-2">
                <button
                  onClick={handleIsolateUnresponsive}
                  disabled={selectedPanels === 0}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition-colors"
                >
                  <Shield size={16} />
                  Isolate Unresponsive
                </button>
                <button
                  onClick={handleUnisolateAll}
                  disabled={isolatedCount === 0}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition-colors"
                >
                  <ShieldOff size={16} />
                  Unisolate All
                </button>
                <div className="text-sm text-gray-400 mt-2">
                  Isolated components: {isolatedCount} / {totalPanels}
                </div>
              </div>
            </div>

            {/* Auto-Protection Status */}
            <div className="mt-4 p-3 bg-gray-800 rounded">
              <h3 className="text-sm font-semibold mb-2 text-gray-300 flex items-center gap-2">
                <Shield size={16} />
                Auto-Protection
              </h3>
              <div className="space-y-1 text-xs text-gray-400">
                <p>• Monitoring component health</p>
                <p>• Auto-isolate on crash detection</p>
                <p>• Background process throttling</p>
              </div>
            </div>
          </>
        )}

        {activeTab === 'state' && (
          <>
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">State Management</h3>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={handleSaveState}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
                >
                  <Save size={16} />
                  Save
                </button>
                <button
                  onClick={handleLoadState}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm transition-colors"
                >
                  <RotateCcw size={16} />
                  Reload
                </button>
                <button
                  onClick={handleExportState}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors"
                >
                  <Download size={16} />
                  Export
                </button>
                <label className="flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm transition-colors cursor-pointer">
                  <Upload size={16} />
                  Import
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportState}
                    className="hidden"
                  />
                </label>
              </div>
              <button
                onClick={() => {
                  localStorage.removeItem('canvas-state')
                  console.log('Canvas state cleared from localStorage')
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors"
              >
                <Trash2 size={16} />
                Clear All State
              </button>
            </div>

            {/* Performance Settings */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2 text-gray-300 flex items-center gap-2">
                <Activity size={16} />
                Performance
              </h3>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="rounded" defaultChecked />
                  <span>Auto-suspend background processes</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="rounded" defaultChecked />
                  <span>Show performance indicators</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="rounded" />
                  <span>Enable WebGL acceleration</span>
                </label>
              </div>
            </div>

            {/* Performance Metrics */}
            <div className="mt-4 p-3 bg-gray-800 rounded">
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Performance Metrics</h3>
              <div className="space-y-1 text-xs text-gray-400">
                <div className="flex justify-between">
                  <span>Visible:</span>
                  <span className="text-green-400">{totalPanels}</span>
                </div>
                <div className="flex justify-between">
                  <span>Rendered:</span>
                  <span className="text-green-400">{totalPanels}</span>
                </div>
                <div className="flex justify-between">
                  <span>Headless Active:</span>
                  <span className="text-yellow-400">{performanceMetrics.headlessActive}</span>
                </div>
                <div className="flex justify-between">
                  <span>FPS:</span>
                  <span className={performanceMetrics.fps >= 30 ? "text-green-400" : "text-yellow-400"}>
                    {performanceMetrics.fps}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Memory:</span>
                  <span className={performanceMetrics.memory < 100 ? "text-green-400" : "text-yellow-400"}>
                    {performanceMetrics.memory}MB
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Stats Footer */}
      <div className="bg-gray-800 px-4 py-3 border-t border-gray-700 text-xs space-y-1 text-gray-400">
        <div className="flex justify-between">
          <span>Total Components:</span>
          <span className="text-white">{totalPanels}</span>
        </div>
        <div className="flex justify-between">
          <span>Selected:</span>
          <span className="text-white">{selectedPanels}</span>
        </div>
        <div className="flex justify-between">
          <span>Isolated:</span>
          <span className="text-white">{isolatedCount}</span>
        </div>
        <div className="flex justify-between">
          <span>Mode:</span>
          <span className="text-white">{state.canvasState.isPanMode ? 'Pan' : 'Select'}</span>
        </div>
      </div>
    </div>
  )
}