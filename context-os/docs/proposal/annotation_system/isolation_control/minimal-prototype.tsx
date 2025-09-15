/**
 * Minimal Prototype - Calculator Component with Isolation Control
 * This is a working prototype demonstrating isolation control on a single component
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================================
// Simplified Isolation System for Prototype
// ============================================================================

class SimpleIsolationManager {
  private metrics: Map<string, number[]> = new Map();
  private isolated: Set<string> = new Set();
  private fpsHistory: number[] = [];
  private lastFrameTime = performance.now();
  
  recordMetric(componentId: string, renderTime: number) {
    const history = this.metrics.get(componentId) || [];
    history.push(renderTime);
    if (history.length > 10) history.shift();
    this.metrics.set(componentId, history);
    
    // Check if should isolate
    const avgRenderTime = history.reduce((a, b) => a + b, 0) / history.length;
    if (avgRenderTime > 50 && !this.isolated.has(componentId)) {
      this.isolate(componentId);
    }
  }
  
  updateFPS() {
    const now = performance.now();
    const fps = 1000 / (now - this.lastFrameTime);
    this.lastFrameTime = now;
    
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 30) this.fpsHistory.shift();
    
    return Math.round(this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length);
  }
  
  isolate(componentId: string) {
    this.isolated.add(componentId);
    window.dispatchEvent(new CustomEvent('component-isolated', { 
      detail: { componentId } 
    }));
  }
  
  restore(componentId: string) {
    this.isolated.delete(componentId);
    this.metrics.delete(componentId);
    window.dispatchEvent(new CustomEvent('component-restored', { 
      detail: { componentId } 
    }));
  }
  
  isIsolated(componentId: string): boolean {
    return this.isolated.has(componentId);
  }
  
  getMetrics(componentId: string) {
    const history = this.metrics.get(componentId) || [];
    const avg = history.length > 0 
      ? history.reduce((a, b) => a + b, 0) / history.length 
      : 0;
    
    return {
      avgRenderTime: Math.round(avg),
      samples: history.length,
      lastRenderTime: history[history.length - 1] || 0
    };
  }
}

// Global instance
const isolationManager = new SimpleIsolationManager();

// ============================================================================
// Calculator Component with Heavy Operations
// ============================================================================

interface CalculatorProps {
  id: string;
  onMetricsUpdate?: (metrics: any) => void;
}

function Calculator({ id, onMetricsUpdate }: CalculatorProps) {
  const [display, setDisplay] = useState('0');
  const [operation, setOperation] = useState<string | null>(null);
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const [isIsolated, setIsIsolated] = useState(false);
  const [heavyMode, setHeavyMode] = useState(false);
  const renderStartTime = useRef(performance.now());
  
  // Track render time
  useEffect(() => {
    const renderTime = performance.now() - renderStartTime.current;
    isolationManager.recordMetric(id, renderTime);
    
    const metrics = isolationManager.getMetrics(id);
    onMetricsUpdate?.(metrics);
  });
  
  // Listen for isolation events
  useEffect(() => {
    const handleIsolation = (e: CustomEvent) => {
      if (e.detail.componentId === id) {
        setIsIsolated(true);
      }
    };
    
    const handleRestoration = (e: CustomEvent) => {
      if (e.detail.componentId === id) {
        setIsIsolated(false);
      }
    };
    
    window.addEventListener('component-isolated' as any, handleIsolation);
    window.addEventListener('component-restored' as any, handleRestoration);
    
    return () => {
      window.removeEventListener('component-isolated' as any, handleIsolation);
      window.removeEventListener('component-restored' as any, handleRestoration);
    };
  }, [id]);
  
  // Simulate heavy operation
  const performHeavyCalculation = useCallback(() => {
    if (heavyMode && !isIsolated) {
      // Simulate expensive computation
      const start = performance.now();
      let result = 0;
      for (let i = 0; i < 10000000; i++) {
        result += Math.sqrt(i);
      }
      console.log(`Heavy calculation took ${performance.now() - start}ms`);
    }
  }, [heavyMode, isIsolated]);
  
  // Run heavy calculation on each render if in heavy mode
  useEffect(() => {
    performHeavyCalculation();
  }, [display, performHeavyCalculation]);
  
  const handleNumber = (num: string) => {
    if (isIsolated) return; // Don't update when isolated
    
    if (display === '0') {
      setDisplay(num);
    } else {
      setDisplay(display + num);
    }
  };
  
  const handleOperation = (op: string) => {
    if (isIsolated) return;
    
    setPreviousValue(display);
    setOperation(op);
    setDisplay('0');
  };
  
  const calculate = () => {
    if (isIsolated) return;
    
    if (operation && previousValue) {
      const prev = parseFloat(previousValue);
      const current = parseFloat(display);
      let result = 0;
      
      switch (operation) {
        case '+': result = prev + current; break;
        case '-': result = prev - current; break;
        case '*': result = prev * current; break;
        case '/': result = prev / current; break;
      }
      
      setDisplay(result.toString());
      setOperation(null);
      setPreviousValue(null);
    }
  };
  
  const clear = () => {
    if (isIsolated) return;
    
    setDisplay('0');
    setOperation(null);
    setPreviousValue(null);
  };
  
  // Render isolated placeholder
  if (isIsolated) {
    return (
      <div className="calculator-isolated p-4 bg-gray-800 rounded-lg border-2 border-yellow-500">
        <div className="text-yellow-400 font-bold mb-2">Calculator Isolated</div>
        <div className="text-gray-400 text-sm mb-4">
          Component temporarily suspended due to performance issues
        </div>
        <button
          onClick={() => isolationManager.restore(id)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Restore Calculator
        </button>
      </div>
    );
  }
  
  // Normal calculator render
  return (
    <div className="calculator p-4 bg-gray-900 rounded-lg">
      {/* Heavy Mode Toggle */}
      <div className="mb-4 flex items-center justify-between">
        <label className="text-white text-sm">Heavy Mode:</label>
        <button
          onClick={() => setHeavyMode(!heavyMode)}
          className={`px-3 py-1 rounded text-sm ${
            heavyMode ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'
          }`}
        >
          {heavyMode ? 'ON (Slow)' : 'OFF'}
        </button>
      </div>
      
      {/* Display */}
      <div className="display bg-gray-800 text-white text-right p-3 mb-4 rounded text-2xl font-mono">
        {display}
      </div>
      
      {/* Buttons */}
      <div className="grid grid-cols-4 gap-2">
        {/* Row 1 */}
        <button onClick={clear} className="col-span-2 btn btn-gray">Clear</button>
        <button onClick={() => handleOperation('/')} className="btn btn-orange">/</button>
        <button onClick={() => handleOperation('*')} className="btn btn-orange">*</button>
        
        {/* Row 2 */}
        <button onClick={() => handleNumber('7')} className="btn btn-dark">7</button>
        <button onClick={() => handleNumber('8')} className="btn btn-dark">8</button>
        <button onClick={() => handleNumber('9')} className="btn btn-dark">9</button>
        <button onClick={() => handleOperation('-')} className="btn btn-orange">-</button>
        
        {/* Row 3 */}
        <button onClick={() => handleNumber('4')} className="btn btn-dark">4</button>
        <button onClick={() => handleNumber('5')} className="btn btn-dark">5</button>
        <button onClick={() => handleNumber('6')} className="btn btn-dark">6</button>
        <button onClick={() => handleOperation('+')} className="btn btn-orange">+</button>
        
        {/* Row 4 */}
        <button onClick={() => handleNumber('1')} className="btn btn-dark">1</button>
        <button onClick={() => handleNumber('2')} className="btn btn-dark">2</button>
        <button onClick={() => handleNumber('3')} className="btn btn-dark">3</button>
        <button onClick={calculate} className="btn btn-green row-span-2">=</button>
        
        {/* Row 5 */}
        <button onClick={() => handleNumber('0')} className="col-span-2 btn btn-dark">0</button>
        <button onClick={() => handleNumber('.')} className="btn btn-dark">.</button>
      </div>
    </div>
  );
}

// ============================================================================
// Monitoring Dashboard
// ============================================================================

function MonitoringDashboard() {
  const [fps, setFps] = useState(60);
  const [metrics, setMetrics] = useState<any>({});
  const [isolatedComponents, setIsolatedComponents] = useState<Set<string>>(new Set());
  const animationFrameRef = useRef<number>();
  
  // FPS tracking
  useEffect(() => {
    const updateFPS = () => {
      const currentFps = isolationManager.updateFPS();
      setFps(currentFps);
      animationFrameRef.current = requestAnimationFrame(updateFPS);
    };
    
    animationFrameRef.current = requestAnimationFrame(updateFPS);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);
  
  // Listen for isolation events
  useEffect(() => {
    const handleIsolation = (e: CustomEvent) => {
      setIsolatedComponents(prev => new Set([...prev, e.detail.componentId]));
    };
    
    const handleRestoration = (e: CustomEvent) => {
      setIsolatedComponents(prev => {
        const next = new Set(prev);
        next.delete(e.detail.componentId);
        return next;
      });
    };
    
    window.addEventListener('component-isolated' as any, handleIsolation);
    window.addEventListener('component-restored' as any, handleRestoration);
    
    return () => {
      window.removeEventListener('component-isolated' as any, handleIsolation);
      window.removeEventListener('component-restored' as any, handleRestoration);
    };
  }, []);
  
  return (
    <div className="monitoring-dashboard p-4 bg-gray-800 rounded-lg text-white">
      <h3 className="text-lg font-bold mb-4">Isolation Monitor</h3>
      
      {/* FPS Display */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-400">FPS:</span>
          <span className={`text-2xl font-mono ${
            fps > 50 ? 'text-green-400' : 
            fps > 30 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {fps}
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all ${
              fps > 50 ? 'bg-green-400' : 
              fps > 30 ? 'bg-yellow-400' : 'bg-red-400'
            }`}
            style={{ width: `${Math.min(100, (fps / 60) * 100)}%` }}
          />
        </div>
      </div>
      
      {/* Component Metrics */}
      <div className="mb-4">
        <h4 className="text-sm font-semibold mb-2 text-gray-400">Component Metrics</h4>
        {Object.entries(metrics).map(([id, data]: [string, any]) => (
          <div key={id} className="mb-2 p-2 bg-gray-700 rounded">
            <div className="flex justify-between text-sm">
              <span>{id}:</span>
              <span className={`font-mono ${
                data.avgRenderTime > 50 ? 'text-red-400' : 
                data.avgRenderTime > 20 ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {data.avgRenderTime}ms avg
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {data.samples} samples, last: {Math.round(data.lastRenderTime)}ms
            </div>
          </div>
        ))}
      </div>
      
      {/* Isolated Components */}
      <div>
        <h4 className="text-sm font-semibold mb-2 text-gray-400">Isolated Components</h4>
        {isolatedComponents.size > 0 ? (
          <div className="space-y-1">
            {Array.from(isolatedComponents).map(id => (
              <div key={id} className="text-sm text-yellow-400">
                • {id} (isolated)
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No components isolated</div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main App with Prototype
// ============================================================================

export function IsolationPrototype() {
  const [calculatorMetrics, setCalculatorMetrics] = useState({});
  
  return (
    <div className="isolation-prototype min-h-screen bg-gray-950 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">
          Isolation Control Prototype
        </h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calculator Component */}
          <div className="lg:col-span-2">
            <h2 className="text-xl font-semibold text-white mb-4">
              Calculator Component
            </h2>
            <Calculator 
              id="calculator-1" 
              onMetricsUpdate={(metrics) => 
                setCalculatorMetrics({ 'calculator-1': metrics })
              }
            />
            
            <div className="mt-4 p-4 bg-gray-800 rounded-lg text-gray-300 text-sm">
              <h3 className="font-semibold mb-2">Instructions:</h3>
              <ol className="space-y-1 list-decimal list-inside">
                <li>Turn on "Heavy Mode" to simulate expensive operations</li>
                <li>Click calculator buttons to trigger renders</li>
                <li>Watch the monitoring dashboard for performance metrics</li>
                <li>Component will auto-isolate if render time exceeds 50ms</li>
                <li>Click "Restore" to bring back the isolated component</li>
              </ol>
            </div>
          </div>
          
          {/* Monitoring Dashboard */}
          <div>
            <h2 className="text-xl font-semibold text-white mb-4">
              Monitoring
            </h2>
            <MonitoringDashboard />
          </div>
        </div>
      </div>
      
      <style jsx>{`
        .btn {
          @apply px-4 py-3 rounded font-semibold transition-all active:scale-95;
        }
        .btn-dark {
          @apply bg-gray-700 text-white hover:bg-gray-600;
        }
        .btn-gray {
          @apply bg-gray-600 text-white hover:bg-gray-500;
        }
        .btn-orange {
          @apply bg-orange-600 text-white hover:bg-orange-500;
        }
        .btn-green {
          @apply bg-green-600 text-white hover:bg-green-500;
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// Export for testing
// ============================================================================

export default IsolationPrototype;