"use client"

import React, { useState, useRef, useEffect } from 'react'
import { useCanvas } from './canvas-context'
import { X, Plus, Hand, ZoomIn, ZoomOut, RotateCcw, Layers, Lock, Unlock, 
         Trash2, Save, Download, Upload, Settings, Activity, MousePointer,
         Move, Box, FileText, Timer, Calculator, TestTube, Shield, ShieldOff } from 'lucide-react'
import { CanvasItem, isComponent } from '@/types/canvas-items'

interface ControlPanelProps {
  visible?: boolean
  onClose?: () => void
  canvasItems?: CanvasItem[]
  onAddComponent?: (type: string, position?: { x: number; y: number }) => void
}

export function EnhancedControlPanel({ visible = true, onClose, canvasItems = [], onAddComponent }: ControlPanelProps) {
  const { state, dispatch, dataStore } = useCanvas()
  const [activeTab, setActiveTab] = useState<'canvas' | 'isolation' | 'state'>('canvas')
  const [selectionMode, setSelectionMode] = useState<'single' | 'multi'>('single')
  const [isolatedComponents, setIsolatedComponents] = useState<string[]>([])
  const [isolationEnabled, setIsolationEnabled] = useState(false)
  const [performanceMetrics, setPerformanceMetrics] = useState({
    fps: 60,
    memory: 45,
    headlessActive: 0
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Get panel statistics
  const totalPanels = state.panels.size
  const selectedPanels = Array.from(state.panels.values()).filter(p => p.selected).length
  const isolatedCount = isolatedComponents.length

  // Monitor FPS and isolation state
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
    
    // Check isolation API
    const checkIsolation = () => {
      const debug = (window as any).__isolationDebug
      if (debug) {
        const isolated = debug.list() || []
        setIsolatedComponents(isolated)
      }
    }
    
    const interval = setInterval(checkIsolation, 500)
    checkIsolation()
    
    return () => {
      if (animationId) cancelAnimationFrame(animationId)
      clearInterval(interval)
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
    // Use the onAddComponent prop if provided, otherwise fall back to old behavior
    if (onAddComponent) {
      onAddComponent(type)
    } else {
      // Fallback to old behavior for backward compatibility
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

  const handleToggleIsolation = () => {
    const debug = (window as any).__isolationDebug
    if (debug) {
      const newEnabled = !isolationEnabled
      debug.enable(newEnabled)
      setIsolationEnabled(newEnabled)
    }
  }

  const handleIsolateUnresponsive = () => {
    // Find components and panels with poor performance metrics
    const debug = (window as any).__isolationDebug
    console.log('[Isolate] Debug API available:', !!debug)
    console.log('[Isolate] Isolation enabled:', isolationEnabled)
    console.log('[Isolate] Canvas items:', canvasItems)
    console.log('[Isolate] Panels:', state.panels)
    
    if (debug && isolationEnabled) {
      // Get all isolatable items: components from canvasItems and panels from state
      const components = canvasItems.filter(isComponent)
      const panels = Array.from(state.panels.entries())
        .filter(([id]) => id !== 'main') // Don't isolate main panel
        .map(([id, panel]) => ({ id, type: 'panel', ...panel }))
      
      // Combine both lists
      const allItems = [
        ...components,
        ...panels
      ]
      
      console.log('[Isolate] Components found:', components)
      console.log('[Isolate] Panels found:', panels)
      console.log('[Isolate] All isolatable items:', allItems)
      console.log('[Isolate] Already isolated:', isolatedComponents)
      
      // In a real implementation, this would use performance heuristics
      // For demo: alternate between panels and components, or isolate based on a pattern
      let isolated = false
      
      // First, try to isolate a panel if there are fewer isolated panels than components
      const isolatedPanels = panels.filter(p => isolatedComponents.includes(p.id))
      const isolatedComps = components.filter(c => isolatedComponents.includes(c.id))
      
      // Prefer panels if we have fewer isolated panels
      let itemsToCheck = allItems
      if (isolatedPanels.length < isolatedComps.length && panels.length > isolatedPanels.length) {
        // Prioritize panels
        itemsToCheck = [...panels, ...components]
        console.log('[Isolate] Prioritizing panels for isolation')
      } else if (components.length > isolatedComps.length) {
        // Prioritize components
        itemsToCheck = [...components, ...panels]
        console.log('[Isolate] Prioritizing components for isolation')
      }
      
      for (const item of itemsToCheck) {
        if (!isolatedComponents.includes(item.id)) {
          console.log('[Isolate] Isolating item:', item.id, 'type:', item.type || 'component')
          debug.isolate(item.id)
          isolated = true
          break // Isolate one at a time for demo
        }
      }
      
      if (!isolated && allItems.length === 0) {
        console.log('[Isolate] No items to isolate. Add some components or panels first.')
        alert('No items to isolate. Please add some components or create additional note panels first.')
      } else if (!isolated) {
        console.log('[Isolate] All items are already isolated')
        alert('All panels and components are already isolated.')
      }
    } else {
      if (!debug) {
        console.error('[Isolate] Debug API not available')
      }
      if (!isolationEnabled) {
        console.log('[Isolate] Isolation is disabled')
      }
    }
  }

  const handleRestoreAll = () => {
    const debug = (window as any).__isolationDebug
    if (debug) {
      const isolated = debug.list() || []
      isolated.forEach((id: string) => debug.restore(id))
      setIsolatedComponents([])
    }
  }

  const handleRestoreComponent = (id: string) => {
    const debug = (window as any).__isolationDebug
    if (debug) {
      debug.restore(id)
      setIsolatedComponents(prev => prev.filter(i => i !== id))
    }
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
            {/* Isolation Header with Enable Toggle */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Lock size={16} />
                Isolation Control
              </h3>
              <button
                onClick={handleToggleIsolation}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  isolationEnabled
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                {isolationEnabled ? 'Enabled' : 'Disabled'}
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
                  performanceMetrics.fps >= 50 ? 'text-green-400' :
                  performanceMetrics.fps >= 30 ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                  {performanceMetrics.fps}
                </span>
              </div>
              
              {/* FPS Bar */}
              <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${
                    performanceMetrics.fps >= 50 ? 'bg-green-500' :
                    performanceMetrics.fps >= 30 ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, (performanceMetrics.fps / 60) * 100)}%` }}
                />
              </div>
              
              {/* Status */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">
                  {performanceMetrics.fps < 30 ? 'Performance degraded' : 
                   performanceMetrics.fps < 50 ? 'Moderate performance' : 
                   'Optimal performance'}
                </span>
                {performanceMetrics.fps < 30 && isolationEnabled && (
                  <span className="text-yellow-400 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Auto-isolation active
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              <button
                onClick={handleIsolateUnresponsive}
                disabled={!isolationEnabled}
                className="w-full px-4 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 
                           disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed
                           text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
              >
                <Lock className="w-4 h-4" />
                Isolate Unresponsive
              </button>
              
              <button
                onClick={handleRestoreAll}
                disabled={isolatedCount === 0}
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
                  {isolatedCount} / {totalPanels}
                </span>
              </div>
              
              {isolatedCount > 0 ? (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {isolatedComponents.map(id => (
                    <div key={id} className="flex items-center justify-between py-1 px-2 bg-gray-700 rounded text-xs">
                      <span className="text-yellow-400 truncate flex-1">{id}</span>
                      <button
                        onClick={() => handleRestoreComponent(id)}
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
                <span className="text-gray-400">30 FPS</span>
              </div>
              <div className="flex justify-between">
                <span>Auto-restore:</span>
                <span className="text-gray-400">After 10s</span>
              </div>
              <div className="flex justify-between">
                <span>Max isolated:</span>
                <span className="text-gray-400">2 components</span>
              </div>
            </div>

            {/* Info */}
            <div className="text-xs text-gray-500 italic p-2 bg-gray-800 rounded">
              <Shield className="w-3 h-3 inline mr-1 text-yellow-500" />
              Components are automatically isolated when they impact performance. 
              Isolated components preserve data while suspended.
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