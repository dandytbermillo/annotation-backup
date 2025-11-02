'use client';

import React from 'react';
import { Constellation, ConstellationItem } from '@/types/constellation';
import { getItemIcon } from '@/lib/constellation/constellation-utils';

interface ConstellationSidebarProps {
  constellations: Constellation[];
  allItems: ConstellationItem[];
  selectedItem: ConstellationItem | null;
  highlightedConstellation: string | null;
  onConstellationClick: (constellationId: string) => void;
  onItemClick: (item: ConstellationItem) => void;
  onClose?: () => void;
  layout?: 'floating' | 'embedded';
  showHeader?: boolean;
}

export default function ConstellationSidebar({
  constellations,
  allItems,
  selectedItem,
  highlightedConstellation,
  onConstellationClick,
  onItemClick,
  onClose,
  layout = 'floating',
  showHeader = true,
}: ConstellationSidebarProps) {
  const containerClass =
    layout === 'floating'
      ? 'rounded-lg shadow-2xl overflow-hidden'
      : 'flex h-full w-full flex-col rounded-2xl shadow-2xl overflow-hidden';

  const containerStyle: React.CSSProperties =
    layout === 'floating'
      ? {
          position: 'absolute',
          left: '20px',
          top: '20px',
          bottom: '20px',
          width: '320px',
          backgroundColor: 'rgba(30, 41, 59, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(71, 85, 105, 0.5)',
          zIndex: 20,
        }
      : {
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(30, 41, 59, 0.94)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(71, 85, 105, 0.45)',
        };

  const headerBorderColor =
    layout === 'embedded' ? 'rgba(71, 85, 105, 0.35)' : 'rgba(71, 85, 105, 0.5)';

  return (
    <div className={containerClass} style={containerStyle}>
      {showHeader && (
        <div className="relative p-4 border-b" style={{ borderBottomColor: headerBorderColor }}>
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-3 right-3 transition-colors text-xl leading-none w-6 h-6 flex items-center justify-center"
              style={{ color: '#94a3b8' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
            >
              ×
            </button>
          )}
          <h2 className="text-xl font-semibold mb-1" style={{ color: '#60a5fa' }}>
            Universal Data Constellation
          </h2>
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            Your personal data universe organized by context
          </p>

          <div className="flex gap-4 mt-3 text-xs" style={{ color: '#64748b' }}>
            <span>Items: {allItems.length}</span>
            <span>Groups: {constellations.length}</span>
            <span>Connections: {allItems.length - 1 + 5}</span>
          </div>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto">
        {/* Get center nodes from allItems instead of constellation.items */}
        {allItems
          .filter(item => item.isCenter) // Only constellation centers
          .map((centerItem) => {
            const isSelected = selectedItem?.id === centerItem.id;

            // Count direct children for this constellation
            const childCount = allItems.filter(item =>
              item.constellation === centerItem.constellation &&
              item.depthLayer === 2
            ).length;

            return (
              <div key={centerItem.id} style={{ borderBottom: '1px solid rgba(51, 65, 85, 0.5)' }}>
                <button
                  className="w-full p-4 text-left transition-all duration-200"
                  style={{
                    backgroundColor: isSelected ? 'rgba(51, 65, 85, 0.3)' : 'transparent',
                    borderLeft: isSelected ? '2px solid #60a5fa' : '2px solid transparent'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(51, 65, 85, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  onClick={() => onItemClick(centerItem)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{centerItem.icon || '⭐'}</span>
                      <span className="font-medium" style={{ color: isSelected ? '#60a5fa' : '#e2e8f0' }}>
                        {centerItem.title}
                      </span>
                    </div>
                    <span
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: '#94a3b8', backgroundColor: 'rgba(51, 65, 85, 0.5)' }}
                    >
                      {childCount}
                    </span>
                  </div>
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
} 
