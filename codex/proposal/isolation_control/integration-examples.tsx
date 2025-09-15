/**
 * Integration Examples - How to integrate isolation control with canvas components
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { 
  IsolationAware, 
  Priority, 
  ResourceMetrics,
  useIsolation,
  ComponentProfiler
} from './core-implementation';

// ============================================================================
// Example 1: Making ComponentPanel Isolation-Aware
// ============================================================================

interface ComponentPanelProps {
  id: string;
  type: 'calculator' | 'timer' | 'editor' | 'dragtest';
  position: { x: number; y: number };
  onClose?: (id: string) => void;
  onPositionChange?: (id: string, position: { x: number; y: number }) => void;
}

export class IsolationAwareComponentPanel implements IsolationAware {
  private id: string;
  private type: string;
  private container: HTMLDivElement | null = null;
  private abortController = new AbortController();
  private timers = new Set<number>();
  private autosaveTimer: number | null = null;
  
  constructor(id: string, type: string) {
    this.id = id;
    this.type = type;
  }
  
  // IsolationAware Implementation
  getId(): string {
    return this.id;
  }
  
  getPriority(): Priority {
    // Main components get higher priority
    if (this.type === 'editor') return 'high';
    if (this.type === 'calculator') return 'normal';
    return 'low';
  }
  
  onIsolate(level: 'soft' | 'hard'): void {
    if (level === 'soft') {
      // Pause animations and non-critical updates
      this.pauseAnimations();
      this.throttleUpdates();
    } else {
      // Hard isolation - cleanup everything except autosave
      this.abortController.abort();
      this.clearNonCriticalTimers();
      this.releaseResources();
    }
  }
  
  onResume(): void {
    // Restore normal operation
    this.resumeAnimations();
    this.restoreUpdateRate();
    
    // Create new abort controller
    this.abortController = new AbortController();
  }
  
  reportResources(): ResourceMetrics {
    const container = this.container;
    if (!container) {
      return {
        eventListeners: 0,
        domNodes: 0,
        canvasPixels: 0,
        timers: 0,
        memoryEstimate: 0
      };
    }
    
    return {
      eventListeners: this.countEventListeners(container),
      domNodes: container.querySelectorAll('*').length,
      canvasPixels: this.calculateCanvasPixels(container),
      timers: this.timers.size,
      memoryEstimate: this.estimateMemory()
    };
  }
  
  getCanvases(): HTMLCanvasElement[] {
    if (!this.container) return [];
    return Array.from(this.container.querySelectorAll('canvas'));
  }
  
  abortOperations(): void {
    this.abortController.abort();
  }
  
  async flushPendingChanges(): Promise<void> {
    // Save any pending data
    if (this.type === 'editor') {
      await this.saveEditorContent();
    }
  }
  
  renderPlaceholder(): React.ReactNode {
    return (
      <div className="p-4 bg-gray-800 rounded-lg border border-yellow-500">
        <div className="text-yellow-400 font-semibold mb-2">
          Component Isolated
        </div>
        <div className="text-gray-400 text-sm">
          {this.type} temporarily suspended for performance
        </div>
        <button 
          onClick={() => this.requestRestore()}
          className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-sm"
        >
          Restore Component
        </button>
      </div>
    );
  }
  
  // Private helper methods
  private pauseAnimations() {
    if (this.container) {
      this.container.style.animationPlayState = 'paused';
    }
  }
  
  private resumeAnimations() {
    if (this.container) {
      this.container.style.animationPlayState = 'running';
    }
  }
  
  private throttleUpdates() {
    // Implement update throttling
  }
  
  private restoreUpdateRate() {
    // Restore normal update rate
  }
  
  private clearNonCriticalTimers() {
    this.timers.forEach(timerId => {
      if (timerId !== this.autosaveTimer) {
        clearTimeout(timerId);
        this.timers.delete(timerId);
      }
    });
  }
  
  private releaseResources() {
    // Release heavy resources
    const canvases = this.getCanvases();
    canvases.forEach(canvas => {
      canvas.width = 0;
      canvas.height = 0;
    });
  }
  
  private countEventListeners(element: HTMLElement): number {
    // Estimate event listener count
    let count = 0;
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    
    while (walker.nextNode()) {
      const node = walker.currentNode as HTMLElement;
      // Check for inline handlers
      for (const attr of node.attributes) {
        if (attr.name.startsWith('on')) count++;
      }
    }
    
    return count;
  }
  
  private calculateCanvasPixels(container: HTMLElement): number {
    const canvases = container.querySelectorAll('canvas');
    let totalPixels = 0;
    
    canvases.forEach(canvas => {
      totalPixels += canvas.width * canvas.height;
    });
    
    return totalPixels;
  }
  
  private estimateMemory(): number {
    // Rough memory estimate based on DOM size and canvas pixels
    const domSize = (this.container?.innerHTML.length || 0) * 2; // UTF-16
    const canvasMemory = this.calculateCanvasPixels(this.container!) * 4; // RGBA
    
    return domSize + canvasMemory;
  }
  
  private async saveEditorContent() {
    // Implement editor save
    console.log('Saving editor content...');
  }
  
  private requestRestore() {
    window.dispatchEvent(new CustomEvent('request-restore', {
      detail: { componentId: this.id }
    }));
  }
}

// ============================================================================
// Example 2: React Component with Isolation Hook
// ============================================================================

export function ComponentPanelWithIsolation({ 
  id, 
  type, 
  position, 
  onClose, 
  onPositionChange 
}: ComponentPanelProps) {
  const { isIsolated, level } = useIsolation(id);
  const profiler = useRef<ComponentProfiler>();
  const isolationAdapter = useRef<IsolationAwareComponentPanel>();
  
  // Initialize isolation adapter
  useEffect(() => {
    isolationAdapter.current = new IsolationAwareComponentPanel(id, type);
  }, [id, type]);
  
  // Wrap all operations with profiler
  const handleOperation = useCallback(async (operation: () => Promise<void> | void) => {
    if (!profiler.current) return;
    
    return profiler.current.runWithProfiler(id, operation);
  }, [id]);
  
  // Handle drag with profiling
  const handleDrag = useCallback((e: React.MouseEvent) => {
    handleOperation(() => {
      // Drag logic here
    });
  }, [handleOperation]);
  
  // Render placeholder when isolated
  if (isIsolated) {
    return <>{isolationAdapter.current?.renderPlaceholder()}</>;
  }
  
  // Normal render
  return (
    <div
      id={`component-${id}`}
      data-component-panel
      className="absolute bg-gray-800 rounded-lg shadow-2xl overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '350px',
        minHeight: '300px',
      }}
      onMouseDown={handleDrag}
    >
      {/* Component content */}
      <div className="component-header bg-gradient-to-r from-blue-600 to-blue-700 p-3">
        <span className="text-white font-semibold">{type}</span>
        <button onClick={() => onClose?.(id)}>×</button>
      </div>
      
      <div className="component-content">
        {/* Render actual component based on type */}
        {renderComponent(type)}
      </div>
    </div>
  );
}

function renderComponent(type: string) {
  switch (type) {
    case 'calculator':
      return <div>Calculator Component</div>;
    case 'timer':
      return <div>Timer Component</div>;
    case 'editor':
      return <div>Editor Component</div>;
    case 'dragtest':
      return <div>Drag Test Component</div>;
    default:
      return <div>Unknown Component</div>;
  }
}

// ============================================================================
// Example 3: Control Panel Integration
// ============================================================================

interface IsolationControlsProps {
  isolatedComponents: Set<string>;
  onIsolateUnresponsive: () => void;
  onUnisolateAll: () => void;
  statistics: {
    totalComponents: number;
    isolatedCount: number;
    avgFPS: number;
    healthScores: Map<string, number>;
  };
}

export function IsolationControls({
  isolatedComponents,
  onIsolateUnresponsive,
  onUnisolateAll,
  statistics
}: IsolationControlsProps) {
  const [showDetails, setShowDetails] = useState(false);
  
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-2xl">🔒</span>
        <h3 className="text-xl font-bold text-white">Isolation Controls</h3>
      </div>
      
      {/* Action Buttons */}
      <div className="space-y-2">
        <button
          onClick={onIsolateUnresponsive}
          className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg 
                     font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <span>🔒</span>
          Isolate Unresponsive
        </button>
        
        <button
          onClick={onUnisolateAll}
          className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg 
                     font-semibold flex items-center justify-center gap-2 transition-colors"
          disabled={isolatedComponents.size === 0}
        >
          <span>🔓</span>
          Unisolate All
        </button>
      </div>
      
      {/* Statistics */}
      <div className="text-gray-300">
        <div className="mb-2">
          Isolated components: {isolatedComponents.size} / {statistics.totalComponents}
        </div>
        
        {/* Progress Bar */}
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div 
            className="bg-yellow-500 h-2 rounded-full transition-all"
            style={{ 
              width: `${(isolatedComponents.size / statistics.totalComponents) * 100}%` 
            }}
          />
        </div>
      </div>
      
      {/* Performance Metrics */}
      <div className="bg-gray-800 rounded-lg p-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Current FPS:</span>
          <span className={`font-mono ${statistics.avgFPS < 30 ? 'text-red-400' : 'text-green-400'}`}>
            {statistics.avgFPS}
          </span>
        </div>
        
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-blue-400 text-sm hover:underline"
        >
          {showDetails ? 'Hide' : 'Show'} Component Details
        </button>
      </div>
      
      {/* Component Details */}
      {showDetails && (
        <div className="bg-gray-800 rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
          <h4 className="text-sm font-semibold text-gray-300 mb-2">Component Health</h4>
          {Array.from(statistics.healthScores).map(([id, score]) => (
            <div key={id} className="flex justify-between text-xs">
              <span className="text-gray-400">{id}:</span>
              <span className={getHealthColor(score)}>
                {score.toFixed(2)} {isolatedComponents.has(id) && '(Isolated)'}
              </span>
            </div>
          ))}
        </div>
      )}
      
      {/* Info */}
      <div className="text-xs text-gray-500 italic">
        Components are automatically isolated when they impact performance. 
        Isolated components show reduced functionality but preserve data.
      </div>
    </div>
  );
}

function getHealthColor(score: number): string {
  if (score < 1) return 'text-green-400';
  if (score < 2) return 'text-yellow-400';
  if (score < 3) return 'text-orange-400';
  return 'text-red-400';
}

// ============================================================================
// Example 4: Minimap Integration
// ============================================================================

export function renderIsolatedComponentInMinimap(
  ctx: CanvasRenderingContext2D,
  component: any,
  isolationManager: any
) {
  const isIsolated = isolationManager.getIsolatedComponents().has(component.id);
  
  if (isIsolated) {
    // Save context
    ctx.save();
    
    // Apply isolation visual effect
    ctx.globalAlpha = 0.3; // Make semi-transparent
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)'; // Yellow border
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); // Dashed border
    
    // Draw component with isolation styling
    const pos = worldToMinimap(component.position.x, component.position.y);
    const width = component.dimensions?.width || 350;
    const height = component.dimensions?.height || 300;
    
    // Fill with gray
    ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
    ctx.fillRect(pos.x, pos.y, width * scale, height * scale);
    
    // Draw warning border
    ctx.strokeRect(pos.x, pos.y, width * scale, height * scale);
    
    // Draw isolation indicator
    ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
    ctx.font = '10px monospace';
    ctx.fillText('⚠', pos.x + 2, pos.y + 10);
    
    // Restore context
    ctx.restore();
  } else {
    // Draw normally
    // ... normal drawing code
  }
}

// Helper function (would be imported in real implementation)
function worldToMinimap(x: number, y: number): { x: number; y: number } {
  // Implementation would come from actual minimap
  return { x: 0, y: 0 };
}

const scale = 0.1; // Example scale factor