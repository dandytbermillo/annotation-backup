import React from 'react';

interface GravityCoreProps {
  position: { x: number; y: number };
  globalDepthOffset: number;
  isDragging: boolean;
  isLocked: boolean;
  isVisible: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
}

export default function GravityCore({ 
  position, 
  globalDepthOffset, 
  isDragging, 
  isLocked,
  isVisible,
  onMouseDown,
  onDoubleClick
}: GravityCoreProps) {
  if (!isVisible) return null;

  // Calculate visual properties based on depth
  const depthPercent = (globalDepthOffset + 2000) / 4000; // 0 to 1
  const size = 50 + (globalDepthOffset / 50); // Size changes with depth
  const glowIntensity = isDragging ? 25 : 15;
  
  // Color gradient from blue (far) to gold (close)
  const r = Math.round(64 + (191 * depthPercent)); // 64->255
  const g = Math.round(165 + (50 * depthPercent));  // 165->215 
  const b = Math.round(250 - (215 * depthPercent)); // 250->35
  const color = `rgb(${r}, ${g}, ${b})`;
  
  // Status indicator colors
  const statusColor = globalDepthOffset > 500 ? '#10b981' : // green (forward)
                     globalDepthOffset < -500 ? '#ef4444' : // red (backward)  
                     '#3b82f6'; // blue (center)

  return (
    <div
      className={`fixed z-50 select-none ${isLocked ? 'cursor-not-allowed' : isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto'
      }}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title={isLocked ? 'Gravity Core (Locked - Press L to unlock)' : 'Gravity Core - Drag to control global depth'}
    >
      {/* Main core orb */}
      <div
        className="relative flex items-center justify-center rounded-full border-2"
        style={{
          width: `${Math.max(40, Math.min(80, size))}px`,
          height: `${Math.max(40, Math.min(80, size))}px`,
          background: `radial-gradient(circle at 30% 30%, ${color}, rgba(0,0,0,0.3))`,
          borderColor: statusColor,
          boxShadow: `0 0 ${glowIntensity}px ${color}, inset 0 0 20px rgba(255,255,255,0.1)`,
          filter: isDragging ? 'brightness(1.3)' : 'brightness(1)',
          transition: isDragging ? 'none' : 'all 0.3s ease'
        }}
      >
        {/* Galaxy symbol */}
        <div className="text-2xl" style={{ filter: 'drop-shadow(0 0 5px rgba(0,0,0,0.8))' }}>
          🌌
        </div>
        
        {/* Lock indicator */}
        {isLocked && (
          <div 
            className="absolute top-0 right-0 text-xs"
            style={{ transform: 'translate(50%, -50%)' }}
          >
            🔒
          </div>
        )}
      </div>
      
      {/* Depth indicator */}
      <div 
        className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 rounded text-xs font-mono whitespace-nowrap"
        style={{
          background: 'rgba(0,0,0,0.8)',
          color: statusColor,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
        }}
      >
        {globalDepthOffset === 0 ? 'Center' : 
         globalDepthOffset > 0 ? `+${globalDepthOffset}z` : 
         `${globalDepthOffset}z`}
      </div>
      
      {/* Directional hints */}
      {isDragging && (
        <>
          <div 
            className="absolute left-1/2 transform -translate-x-1/2 text-xs opacity-75 pointer-events-none"
            style={{ 
              top: '-30px',
              color: '#10b981',
              textShadow: '0 0 5px rgba(0,0,0,0.8)'
            }}
          >
            ↑ Forward
          </div>
          <div 
            className="absolute left-1/2 transform -translate-x-1/2 text-xs opacity-75 pointer-events-none"
            style={{ 
              bottom: '-30px',
              color: '#ef4444',
              textShadow: '0 0 5px rgba(0,0,0,0.8)'
            }}
          >
            ↓ Backward
          </div>
        </>
      )}
      
      {/* Pulsing ring animation */}
      <div
        className="absolute inset-0 rounded-full border animate-pulse pointer-events-none"
        style={{
          borderColor: statusColor,
          borderWidth: '1px',
          transform: isDragging ? 'scale(1.5)' : 'scale(1.2)',
          opacity: isDragging ? 0.8 : 0.4,
          transition: isDragging ? 'none' : 'all 0.3s ease'
        }}
      />
    </div>
  );
} 