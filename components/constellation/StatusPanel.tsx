'use client';

import React from 'react';
import { AppState, ConstellationItem } from '@/types/constellation';

interface StatusPanelProps {
  state: AppState;
  allItems: ConstellationItem[];
  onClose?: () => void;
}

export default function StatusPanel({ state, allItems, onClose }: StatusPanelProps) {
  const totalVisible = allItems.filter(item => {
    // Apply similar filtering logic as in the original
    let visible = true;
    
    if (state.highlightedConstellation && state.highlightedConstellation !== 'all') {
      visible = item.constellation === state.highlightedConstellation;
    }
    
    if (state.filterType !== 'all') {
      visible = visible && item.type === state.filterType;
    }
    
    if (state.searchQuery) {
      const matchesSearch = item.title.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
                           (item.tags ? item.tags.some(tag => tag.toLowerCase().includes(state.searchQuery.toLowerCase())) : false);
      visible = visible && matchesSearch;
    }
    
    return visible;
  }).length;

  const customPositions = Object.keys(state.nodePositions).length;

  return (
    <div className="absolute bottom-5 right-5 bg-slate-800/90 backdrop-blur-sm border border-slate-600/50 rounded-lg shadow-2xl p-4 z-20 min-w-64 relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-white transition-colors text-lg leading-none w-5 h-5 flex items-center justify-center"
        >
          ×
        </button>
      )}
      {/* Current state */}
      <div className="space-y-2 text-sm pr-6">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Zoom:</span>
          <span className="text-slate-200 font-mono">{Math.round(state.zoom * 100)}%</span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Rotation:</span>
          <span className="text-slate-200 font-mono">{Math.round(state.rotation.y)}°</span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Visible:</span>
          <span className="text-slate-200">{totalVisible} nodes</span>
        </div>
        
        {customPositions > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Custom positions:</span>
            <span className="text-slate-200">{customPositions}</span>
          </div>
        )}
        
        {state.isDragging && (
          <div className="flex justify-between items-center text-blue-400">
            <span>Mode:</span>
            <span className="capitalize">
              {state.dragMode === 'node' && state.draggedNode 
                ? `Moving: ${allItems.find(i => i.id === state.draggedNode)?.title || 'Node'}`
                : state.dragMode === 'rotate' 
                  ? 'Rotating' 
                  : 'Panning'
              }
            </span>
          </div>
        )}
        
        {state.hoveredItem && !state.isDragging && (
          <div className="flex justify-between items-center text-amber-400">
            <span>Hovering:</span>
            <span className="truncate max-w-32">{state.hoveredItem.title}</span>
          </div>
        )}
        
        {/* Gravity Core Status */}
        {state.gravityCoreVisible && (
          <div className="flex justify-between items-center text-amber-400">
            <span>🌌 Gravity Core:</span>
            <span className="font-mono">
              {state.globalDepthOffset === 0 ? 'Center' : 
               state.globalDepthOffset > 0 ? `+${state.globalDepthOffset}z` : 
               `${state.globalDepthOffset}z`}
              {state.gravityCoreLocked ? ' 🔒' : ''}
            </span>
          </div>
        )}

        {/* Group Selection Status */}
        {state.selectedGroupItems.size > 0 && (
          <div className="flex justify-between items-center text-orange-400">
            <span>📁 Group Selected:</span>
            <span className="font-mono">{state.selectedGroupItems.size} items</span>
          </div>
        )}
        
        {/* Constellation focus status */}
        {state.focusedConstellation && (
          <div className="p-2 mt-2 bg-blue-500/20 border border-blue-400/30 rounded text-blue-300">
            <div className="text-xs font-semibold mb-1">🎯 Constellation Focus Active</div>
            <div className="text-xs">
              Focused: <span className="font-mono">{state.focusedConstellation}</span>
            </div>
            {state.constellationFocusLevels && state.constellationFocusLevels[state.focusedConstellation] && (
              <div className="text-xs">
                Level: <span className="font-mono">{state.constellationFocusLevels[state.focusedConstellation]}/{state.maxFocusLevel}</span>
              </div>
            )}
            <div className="text-xs text-blue-400 mt-1">
              Shift+Click again to focus more • Esc to reset
            </div>
          </div>
        )}
        
        {Object.keys(state.constellationFocusLevels || {}).length > 0 && !state.focusedConstellation && (
          <div className="p-2 mt-2 bg-slate-600/20 border border-slate-500/30 rounded text-slate-300">
            <div className="text-xs font-semibold mb-1">📊 Focus Levels</div>
            {Object.entries(state.constellationFocusLevels || {}).map(([id, level]) => (
              <div key={id} className="text-xs">
                {id}: Level {level}
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Connection Legend */}
      <div className="mt-4 pt-3 border-t border-slate-700/50">
        <div className="text-xs font-semibold text-slate-300 mb-2">🔗 Connection Types</div>
        <div className="text-xs text-slate-400 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-blue-400 rounded"></div>
            <span>Parent-Child (solid)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-green-400 rounded" style={{backgroundImage: 'repeating-linear-gradient(to right, transparent, transparent 2px, currentColor 2px, currentColor 4px)'}}></div>
            <span>Same Constellation (dashed)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-gradient-to-r from-blue-400 to-amber-400 rounded"></div>
            <span>Cross-Constellation (gradient)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-purple-400 rounded" style={{backgroundImage: 'repeating-linear-gradient(to right, transparent, transparent 1px, currentColor 1px, currentColor 2px)'}}></div>
            <span>Semantic Links (dotted)</span>
          </div>
        </div>
        <div className="text-xs text-slate-500 mt-2">
          <div className="text-slate-400 font-medium mb-1">Semantic Colors:</div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span>Financial</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
              <span>Projects</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
              <span>Documents</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-red-400 rounded-full"></div>
              <span>Media</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-violet-400 rounded-full"></div>
              <span>Learning</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-cyan-400 rounded-full"></div>
              <span>Communication</span>
            </div>
          </div>
        </div>
        <div className="text-xs text-slate-500 mt-2">
          <div>💡 Line thickness = importance</div>
          <div>✨ Hover connections for glow effect</div>
        </div>
      </div>
      
      {/* Control hints */}
      <div className="mt-4 pt-3 border-t border-slate-700/50">
        <div className="text-xs text-slate-500 space-y-1">
          <div>🖱️ Left drag: Rotate view</div>
          <div>⇧ Shift+drag: Pan view</div>
          <div>🖱️ Right drag: Pan view</div>
          <div>⚟ Scroll: Zoom in/out</div>
          <div>🎯 Click nodes: Select & details</div>
          <div>📁 Shift+click folder: Select group</div>
          {state.selectedGroupItems.size > 0 && (
            <>
              <div className="border-t border-slate-700/30 pt-1 mt-1"></div>
              <div className="text-orange-400">📦 Drag folder to move entire group</div>
              <div className="text-orange-400">Click (no shift) to clear group</div>
            </>
          )}
          {state.gravityCoreVisible && (
            <>
              <div className="border-t border-slate-700/30 pt-1 mt-2"></div>
              <div>🌌 Drag Gravity Core: Global depth</div>
              <div>G: Toggle gravity core visibility</div>
              <div>L: Lock/unlock gravity core</div>
              <div>R: Reset global depth to center</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
} 