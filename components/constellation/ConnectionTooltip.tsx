'use client';

import React from 'react';

interface ConnectionTooltipProps {
  connectionInfo: {
    item1: string;
    item2: string;
    type: string;
    importance: number;
    x: number;
    y: number;
  } | null;
}

const CONNECTION_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  'parent-child': { label: 'Parent-Child', icon: '👪', color: '#3b82f6' },
  'intra-constellation': { label: 'Same Constellation', icon: '🔗', color: '#10b981' },
  'cross-constellation': { label: 'Cross-Constellation', icon: '🌉', color: '#f59e0b' },
  'semantic': { label: 'Semantic Link', icon: '🧠', color: '#8b5cf6' }
};

const IMPORTANCE_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Very Low', color: '#64748b' },
  2: { label: 'Low', color: '#84cc16' },
  3: { label: 'Medium', color: '#eab308' },
  4: { label: 'High', color: '#f97316' },
  5: { label: 'Critical', color: '#ef4444' }
};

export default function ConnectionTooltip({ connectionInfo }: ConnectionTooltipProps) {
  if (!connectionInfo) return null;

  const { item1, item2, type, importance, x, y } = connectionInfo;
  const typeInfo = CONNECTION_TYPE_LABELS[type] || { label: type, icon: '🔗', color: '#64b5f6' };
  const importanceInfo = IMPORTANCE_LABELS[importance] || { label: 'Unknown', color: '#64748b' };

  // Position tooltip near the connection but avoid screen edges
  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x + 10, window.innerWidth - 280),
    top: Math.max(10, y - 80),
    zIndex: 1000,
    pointerEvents: 'none'
  };

  return (
    <div 
      style={tooltipStyle}
      className="bg-slate-900/95 backdrop-blur-sm border border-slate-600/50 rounded-lg shadow-2xl p-3 max-w-xs"
    >
      <div className="space-y-2">
        {/* Connection Type */}
        <div className="flex items-center gap-2">
          <span className="text-sm">{typeInfo.icon}</span>
          <div 
            className="w-2 h-2 rounded-full" 
            style={{ backgroundColor: typeInfo.color }}
          ></div>
          <span className="text-slate-200 text-sm font-medium">{typeInfo.label}</span>
        </div>

        {/* Connected Items */}
        <div className="text-xs text-slate-300 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">From:</span>
            <span className="font-medium truncate">{item1}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">To:</span>
            <span className="font-medium truncate">{item2}</span>
          </div>
        </div>

        {/* Importance Level */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
          <span className="text-xs text-slate-400">Importance:</span>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(level => (
                <div
                  key={level}
                  className={`w-2 h-2 rounded-full ${
                    level <= importance ? 'opacity-100' : 'opacity-20'
                  }`}
                  style={{ 
                    backgroundColor: level <= importance ? importanceInfo.color : '#64748b'
                  }}
                ></div>
              ))}
            </div>
            <span 
              className="text-xs font-medium"
              style={{ color: importanceInfo.color }}
            >
              {importanceInfo.label}
            </span>
          </div>
        </div>

        {/* Connection Strength Indicator */}
        <div className="pt-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Strength:</span>
            <div className="flex-1 bg-slate-700 rounded-full h-1.5">
              <div 
                className="h-full rounded-full transition-all duration-300"
                style={{ 
                  width: `${(importance / 5) * 100}%`,
                  backgroundColor: importanceInfo.color
                }}
              ></div>
            </div>
            <span className="text-xs text-slate-400 font-mono">{importance}/5</span>
          </div>
        </div>
      </div>
    </div>
  );
} 