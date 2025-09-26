'use client';

import React, { useState } from 'react';
import { 
  Layers, Eye, EyeOff, Link, Unlink, RotateCcw, 
  ChevronDown, ChevronUp, Info, Keyboard, X,
  FileText, FolderOpen
} from 'lucide-react';
import { useLayer } from '@/components/canvas/layer-provider';
import { useFeatureFlag } from '@/lib/offline/feature-flags';
import { getShortcutDisplay } from '@/lib/hooks/use-layer-keyboard-shortcuts';

interface LayerControlsProps {
  className?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * LayerControls - UI component for managing multi-layer canvas
 * Provides visual controls for layer switching, opacity, sync settings, etc.
 */
export const LayerControls: React.FC<LayerControlsProps> = ({ 
  className = '',
  position = 'bottom-right' 
}) => {
  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas');
  const layerModelEnabled = useFeatureFlag('ui.layerModel');
  const isLayerModelEnabled = multiLayerEnabled && layerModelEnabled;
  const layerContext = useLayer();
  const [isExpanded, setIsExpanded] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  
  if (!isLayerModelEnabled || !layerContext) {
    return null;
  }
  
  const { 
    activeLayer, 
    layers, 
    syncPan, 
    syncZoom,
    setActiveLayer,
    updateLayerOpacity,
    updateLayerVisibility,
    toggleSyncPan,
    toggleSyncZoom,
    resetView,
    toggleSidebar,
    isSidebarVisible,
  } = layerContext;
  
  const shortcuts = getShortcutDisplay();
  
  // Position styles
  const positionStyles = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  };
  
  // Layer info
  const notesLayer = layers.get('notes');
  const popupsLayer = layers.get('popups');
  
  return (
    <>
      {/* Main Control Panel */}
      <div 
        className={`fixed ${positionStyles[position]} z-[2000] ${className}`}
        style={{ pointerEvents: 'auto' }}
      >
        <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
          {/* Header */}
          <div 
            className="px-3 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-white">Layer Controls</span>
            </div>
            <button className="p-0.5 hover:bg-gray-700 rounded">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              )}
            </button>
          </div>
          
          {/* Controls */}
          {isExpanded && (
            <div className="p-3 space-y-3">
              {/* Active Layer Indicator */}
              <div className="space-y-2">
                <div className="text-xs text-gray-500 uppercase tracking-wider">Active Layer</div>
                <div className="flex gap-1 bg-gray-800 p-1 rounded">
                  <button
                    onClick={() => setActiveLayer('notes')}
                    className={`flex-1 px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
                      activeLayer === 'notes' 
                        ? 'bg-blue-600 text-white' 
                        : 'text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Notes
                  </button>
                  <button
                    onClick={() => setActiveLayer('popups')}
                    className={`flex-1 px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
                      activeLayer === 'popups' 
                        ? 'bg-purple-600 text-white' 
                        : 'text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Popups
                  </button>
                </div>
                <div className="text-xs text-gray-500 text-center">
                  Press Tab to toggle
                </div>
              </div>
              
              {/* Layer Visibility & Opacity */}
              <div className="space-y-2">
                <div className="text-xs text-gray-500 uppercase tracking-wider">Layer Settings</div>
                
                {/* Notes Layer */}
                <div className="flex items-center gap-2">
                  <button 
                    className="p-1 hover:bg-gray-800 rounded"
                    title="Toggle notes visibility"
                    onClick={() => updateLayerVisibility('notes', !notesLayer?.visible)}
                  >
                    {notesLayer?.visible ? (
                      <Eye className="w-4 h-4 text-green-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                  <span className="text-xs text-gray-400 w-12">Notes</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={(notesLayer?.opacity || 1) * 100}
                    onChange={(e) => updateLayerOpacity('notes', Number(e.target.value) / 100)}
                    className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer opacity-slider"
                    title="Notes layer opacity"
                  />
                  <span className="text-xs text-gray-500 w-8 text-right">
                    {Math.round((notesLayer?.opacity || 1) * 100)}%
                  </span>
                </div>
                
                {/* Popups Layer */}
                <div className="flex items-center gap-2">
                  <button 
                    className="p-1 hover:bg-gray-800 rounded"
                    title="Toggle popups visibility"
                    onClick={() => updateLayerVisibility('popups', !popupsLayer?.visible)}
                  >
                    {popupsLayer?.visible ? (
                      <Eye className="w-4 h-4 text-green-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                  <span className="text-xs text-gray-400 w-12">Popups</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={(popupsLayer?.opacity || 1) * 100}
                    onChange={(e) => updateLayerOpacity('popups', Number(e.target.value) / 100)}
                    className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer opacity-slider"
                    title="Popups layer opacity"
                  />
                  <span className="text-xs text-gray-500 w-8 text-right">
                    {Math.round((popupsLayer?.opacity || 1) * 100)}%
                  </span>
                </div>
              </div>
              
              {/* Sync Controls */}
              <div className="space-y-2">
                <div className="text-xs text-gray-500 uppercase tracking-wider">Sync Settings</div>
                <div className="flex gap-2">
                  <button
                    onClick={toggleSyncPan}
                    className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                      syncPan 
                        ? 'bg-green-600 text-white' 
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                    title="Sync pan movement between layers"
                  >
                    {syncPan ? <Link className="w-3.5 h-3.5" /> : <Unlink className="w-3.5 h-3.5" />}
                    Pan
                  </button>
                  <button
                    onClick={toggleSyncZoom}
                    className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                      syncZoom 
                        ? 'bg-green-600 text-white' 
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                    title="Sync zoom level between layers"
                  >
                    {syncZoom ? <Link className="w-3.5 h-3.5" /> : <Unlink className="w-3.5 h-3.5" />}
                    Zoom
                  </button>
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex gap-2 pt-2 border-t border-gray-800">
                <button
                  onClick={resetView}
                  className="flex-1 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium text-gray-300 transition-colors flex items-center justify-center gap-1"
                  title="Reset view to origin (Cmd/Ctrl+0)"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
                <button
                  onClick={toggleSidebar}
                  className="flex-1 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium text-gray-300 transition-colors flex items-center justify-center gap-1"
                  title="Toggle sidebar (Cmd/Ctrl+B)"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isSidebarVisible ? 'Hide' : 'Show'} Sidebar
                </button>
                <button
                  onClick={() => setShowShortcuts(!showShortcuts)}
                  className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium text-gray-300 transition-colors"
                  title="Show keyboard shortcuts"
                >
                  <Keyboard className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[3000]"
          onClick={() => setShowShortcuts(false)}
        >
          <div 
            className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-4 max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-blue-400" />
                Keyboard Shortcuts
              </h3>
              <button
                onClick={() => setShowShortcuts(false)}
                className="p-1 hover:bg-gray-800 rounded"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            
            <div className="space-y-2">
              {Object.entries(shortcuts).map(([key, description]) => (
                <div key={key} className="flex justify-between items-center py-1">
                  <span className="text-sm text-gray-400">{description}</span>
                  <kbd className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono text-gray-300">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
            
            <div className="mt-4 pt-3 border-t border-gray-800">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Info className="w-3.5 h-3.5" />
                <span>Use Alt or Space with mouse drag for layer-specific panning</span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Visual Layer Indicator Overlay */}
      <div className="fixed top-16 left-1/2 transform -translate-x-1/2 pointer-events-none" style={{ zIndex: 2500 }}>
        <div className="bg-gray-900 bg-opacity-95 border border-gray-700 rounded-full px-4 py-2 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${activeLayer === 'notes' ? 'bg-blue-400' : 'bg-gray-600'}`} />
              <span className={`text-xs font-medium ${activeLayer === 'notes' ? 'text-blue-400' : 'text-gray-500'}`}>
                Notes
              </span>
            </div>
            <div className="w-px h-4 bg-gray-700" />
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${activeLayer === 'popups' ? 'bg-purple-400' : 'bg-gray-600'}`} />
              <span className={`text-xs font-medium ${activeLayer === 'popups' ? 'text-purple-400' : 'text-gray-500'}`}>
                Popups
              </span>
            </div>
            {(syncPan || syncZoom) && (
              <>
                <div className="w-px h-4 bg-gray-700" />
                <div className="flex items-center gap-1">
                  <Link className="w-3 h-3 text-green-400" />
                  <span className="text-xs text-green-400">
                    {syncPan && syncZoom ? 'Synced' : syncPan ? 'Pan' : 'Zoom'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// Export styled component for opacity sliders
export const layerControlsStyles = `
  .opacity-slider::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
  }
  
  .opacity-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
`;

export default LayerControls;
