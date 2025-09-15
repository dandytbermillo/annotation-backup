/**
 * Core Implementation - Isolation Control System
 * This file contains the essential implementation code for the isolation system
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface ComponentMetrics {
  componentId: string;
  renderTime: number;
  timestamp: number;
  errorCount: number;
  resourceUsage: ResourceMetrics;
}

export interface ResourceMetrics {
  eventListeners: number;
  domNodes: number;
  canvasPixels: number;
  timers: number;
  memoryEstimate: number;
}

export interface HealthScore {
  value: number;
  factors: {
    performance: number;
    errors: number;
    resources: number;
  };
  timestamp: number;
}

export type IsolationLevel = 'none' | 'soft' | 'hard';
export type Priority = 'critical' | 'high' | 'normal' | 'low';

export interface IsolationConfig {
  timing: {
    evaluationIntervalMs: number;
    cooldownMs: number;
    restoreDelayMs: number;
  };
  thresholds: {
    frameBudgetMs: number;
    minFPS: number;
    maxRenderMs: number;
    consecutiveBadFrames: number;
    healthScoreThreshold: number;
  };
  budgets: {
    maxEventListeners: number;
    maxDOMNodes: number;
    maxCanvasPixels: number;
    maxTimers: number;
  };
  isolation: {
    maxIsolatedComponents: number;
    neverIsolate: string[];
    priorityOrder: Priority[];
    autoRestore: boolean;
  };
}

// ============================================================================
// Component Profiler
// ============================================================================

export class ComponentProfiler {
  private activeComponents = new Map<string, number>();
  private metrics = new Map<string, ComponentMetrics[]>();
  
  async runWithProfiler<T>(
    componentId: string,
    fn: () => Promise<T> | T
  ): Promise<T> {
    const startTime = performance.now();
    this.activeComponents.set(componentId, startTime);
    
    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      
      this.recordMetric(componentId, {
        componentId,
        renderTime: duration,
        timestamp: performance.now(),
        errorCount: 0,
        resourceUsage: this.captureResources(componentId)
      });
      
      return result;
    } catch (error) {
      this.recordError(componentId, error);
      throw error;
    } finally {
      this.activeComponents.delete(componentId);
    }
  }
  
  private recordMetric(componentId: string, metric: ComponentMetrics) {
    const history = this.metrics.get(componentId) || [];
    history.push(metric);
    
    // Keep last 60 samples
    if (history.length > 60) {
      history.shift();
    }
    
    this.metrics.set(componentId, history);
  }
  
  private recordError(componentId: string, error: unknown) {
    const history = this.metrics.get(componentId) || [];
    const lastMetric = history[history.length - 1];
    
    if (lastMetric) {
      lastMetric.errorCount++;
    }
  }
  
  private captureResources(componentId: string): ResourceMetrics {
    // This would be implemented based on actual component
    // For now, return placeholder
    return {
      eventListeners: 0,
      domNodes: 0,
      canvasPixels: 0,
      timers: 0,
      memoryEstimate: 0
    };
  }
  
  matchLongTask(entry: PerformanceEntry): string | null {
    const tolerance = 10; // ms
    
    for (const [componentId, startTime] of this.activeComponents) {
      if (Math.abs(entry.startTime - startTime) < tolerance) {
        return componentId;
      }
    }
    
    return null;
  }
  
  getMetrics(componentId: string): ComponentMetrics[] {
    return this.metrics.get(componentId) || [];
  }
}

// ============================================================================
// FPS Monitor
// ============================================================================

export class FPSMonitor {
  private fps = 60;
  private lastTime = performance.now();
  private alpha = 0.2; // EWMA smoothing factor
  private rafId: number | null = null;
  
  start() {
    const tick = (now: number) => {
      const delta = now - this.lastTime;
      
      if (delta > 0) {
        const instantFPS = 1000 / delta;
        // Apply EWMA smoothing
        this.fps = this.alpha * instantFPS + (1 - this.alpha) * this.fps;
      }
      
      this.lastTime = now;
      this.rafId = requestAnimationFrame(tick);
    };
    
    this.rafId = requestAnimationFrame(tick);
  }
  
  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
  
  getGlobalFPS(): number {
    return Math.round(this.fps);
  }
  
  isLowFPS(threshold: number = 30): boolean {
    return this.fps < threshold;
  }
}

// ============================================================================
// Health Scorer
// ============================================================================

export class HealthScorer {
  private scores = new Map<string, number>();
  private alpha = 0.3; // EWMA smoothing factor
  
  calculateHealth(
    componentId: string,
    metrics: ComponentMetrics,
    config: IsolationConfig
  ): HealthScore {
    const { thresholds, budgets } = config;
    
    // Performance factor (normalized render time)
    const performanceFactor = metrics.renderTime / thresholds.frameBudgetMs;
    
    // Error factor (weighted errors)
    const errorFactor = metrics.errorCount * 2;
    
    // Resource factor (normalized resource usage)
    const resourceFactor = 
      (metrics.resourceUsage.eventListeners / budgets.maxEventListeners) * 0.25 +
      (metrics.resourceUsage.domNodes / budgets.maxDOMNodes) * 0.25 +
      (metrics.resourceUsage.canvasPixels / budgets.maxCanvasPixels) * 0.25 +
      (metrics.resourceUsage.timers / budgets.maxTimers) * 0.25;
    
    // Combined score
    const currentScore = performanceFactor + errorFactor + resourceFactor;
    
    // Apply EWMA smoothing
    const prevScore = this.scores.get(componentId) || 0;
    const smoothedScore = this.alpha * currentScore + (1 - this.alpha) * prevScore;
    
    this.scores.set(componentId, smoothedScore);
    
    return {
      value: smoothedScore,
      factors: {
        performance: performanceFactor,
        errors: errorFactor,
        resources: resourceFactor
      },
      timestamp: performance.now()
    };
  }
  
  isUnhealthy(score: HealthScore, threshold: number): boolean {
    return score.value > threshold;
  }
}

// ============================================================================
// Isolation Manager
// ============================================================================

export class IsolationManager {
  private isolationHistory = new Map<string, {
    lastIsolatedMs: number;
    consecutiveBadWindows: number;
    cooldownUntilMs: number;
    isolationLevel: IsolationLevel;
  }>();
  
  private isolatedComponents = new Set<string>();
  private config: IsolationConfig;
  private profiler: ComponentProfiler;
  private healthScorer: HealthScorer;
  private fpsMonitor: FPSMonitor;
  
  constructor(config: IsolationConfig) {
    this.config = config;
    this.profiler = new ComponentProfiler();
    this.healthScorer = new HealthScorer();
    this.fpsMonitor = new FPSMonitor();
    
    this.fpsMonitor.start();
    this.startEvaluation();
  }
  
  private startEvaluation() {
    setInterval(() => {
      this.evaluateAllComponents();
    }, this.config.timing.evaluationIntervalMs);
  }
  
  private evaluateAllComponents() {
    // Skip if global FPS is good
    if (!this.fpsMonitor.isLowFPS(this.config.thresholds.minFPS)) {
      return;
    }
    
    // Evaluate each component
    const components = this.getActiveComponents();
    
    for (const componentId of components) {
      this.evaluateComponent(componentId);
    }
  }
  
  private evaluateComponent(componentId: string) {
    // Never isolate protected components
    if (this.config.isolation.neverIsolate.includes(componentId)) {
      return;
    }
    
    // Check if in cooldown
    const history = this.isolationHistory.get(componentId);
    if (history && performance.now() < history.cooldownUntilMs) {
      return;
    }
    
    // Get component metrics
    const metrics = this.profiler.getMetrics(componentId);
    if (metrics.length === 0) return;
    
    const latestMetric = metrics[metrics.length - 1];
    const healthScore = this.healthScorer.calculateHealth(
      componentId,
      latestMetric,
      this.config
    );
    
    // Update history
    const isUnhealthy = this.healthScorer.isUnhealthy(
      healthScore,
      this.config.thresholds.healthScoreThreshold
    );
    
    if (this.shouldIsolate(componentId, isUnhealthy)) {
      this.isolate(componentId, 'soft');
    }
  }
  
  private shouldIsolate(componentId: string, isUnhealthy: boolean): boolean {
    const history = this.isolationHistory.get(componentId) || {
      lastIsolatedMs: 0,
      consecutiveBadWindows: 0,
      cooldownUntilMs: 0,
      isolationLevel: 'none' as IsolationLevel
    };
    
    if (isUnhealthy) {
      history.consecutiveBadWindows++;
      
      // Require consecutive bad windows
      if (history.consecutiveBadWindows >= this.config.thresholds.consecutiveBadFrames) {
        // Check capacity
        if (this.isolatedComponents.size >= this.config.isolation.maxIsolatedComponents) {
          return false; // Hit cap
        }
        
        history.lastIsolatedMs = performance.now();
        history.cooldownUntilMs = performance.now() + this.config.timing.cooldownMs;
        history.consecutiveBadWindows = 0;
        
        this.isolationHistory.set(componentId, history);
        return true;
      }
    } else {
      // Reset on good frame
      history.consecutiveBadWindows = 0;
    }
    
    this.isolationHistory.set(componentId, history);
    return false;
  }
  
  isolate(componentId: string, level: 'soft' | 'hard') {
    this.isolatedComponents.add(componentId);
    
    const history = this.isolationHistory.get(componentId);
    if (history) {
      history.isolationLevel = level;
    }
    
    // Dispatch event for UI update
    this.dispatchIsolationEvent(componentId, level, 'isolated');
  }
  
  restore(componentId: string) {
    this.isolatedComponents.delete(componentId);
    
    const history = this.isolationHistory.get(componentId);
    if (history) {
      history.isolationLevel = 'none';
    }
    
    // Dispatch event for UI update
    this.dispatchIsolationEvent(componentId, 'none', 'restored');
  }
  
  private dispatchIsolationEvent(
    componentId: string,
    level: IsolationLevel,
    action: 'isolated' | 'restored'
  ) {
    window.dispatchEvent(new CustomEvent('component-isolation', {
      detail: { componentId, level, action }
    }));
  }
  
  private getActiveComponents(): string[] {
    // This would be integrated with actual canvas
    // For now, return empty array
    return [];
  }
  
  getIsolatedComponents(): Set<string> {
    return new Set(this.isolatedComponents);
  }
  
  getProfiler(): ComponentProfiler {
    return this.profiler;
  }
  
  destroy() {
    this.fpsMonitor.stop();
  }
}

// ============================================================================
// Isolation Controller
// ============================================================================

export class IsolationController {
  private abortControllers = new Map<string, AbortController>();
  private originalStates = new Map<string, any>();
  
  softIsolate(component: IsolationAware) {
    // Pause visual updates
    component.onIsolate('soft');
    
    // Store original state for restoration
    this.originalStates.set(component.getId(), {
      level: 'soft',
      timestamp: performance.now()
    });
  }
  
  hardIsolate(component: IsolationAware) {
    // Abort network requests
    const controller = new AbortController();
    this.abortControllers.set(component.getId(), controller);
    
    // Full isolation
    component.onIsolate('hard');
    
    // Cleanup resources
    this.cleanup(component);
    
    // Store state
    this.originalStates.set(component.getId(), {
      level: 'hard',
      timestamp: performance.now()
    });
  }
  
  restore(component: IsolationAware) {
    const componentId = component.getId();
    
    // Cancel any abort controllers
    const controller = this.abortControllers.get(componentId);
    if (controller) {
      this.abortControllers.delete(componentId);
    }
    
    // Restore component
    component.onResume();
    
    // Clear stored state
    this.originalStates.delete(componentId);
  }
  
  private cleanup(component: IsolationAware) {
    // Component-specific cleanup
    component.abortOperations();
    
    // Release canvas memory if applicable
    const canvases = component.getCanvases?.();
    if (canvases) {
      canvases.forEach(canvas => {
        if (canvas.getContext) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Store dimensions for restore
            const dims = { width: canvas.width, height: canvas.height };
            this.originalStates.set(`${component.getId()}-canvas`, dims);
            
            // Release backing store
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      });
    }
  }
}

// ============================================================================
// Component Adapter Interface
// ============================================================================

export interface IsolationAware {
  // Identity
  getId(): string;
  getPriority(): Priority;
  
  // Lifecycle
  onIsolate(level: 'soft' | 'hard'): void;
  onResume(): void;
  
  // Resources
  reportResources(): ResourceMetrics;
  getCanvases?(): HTMLCanvasElement[];
  
  // Operations
  abortOperations(): void;
  flushPendingChanges(): Promise<void>;
  
  // UI
  renderPlaceholder(): any;
}

// ============================================================================
// React Hook
// ============================================================================

export function useIsolation(componentId: string) {
  const [isolationState, setIsolationState] = React.useState<{
    isIsolated: boolean;
    level: IsolationLevel;
  }>({
    isIsolated: false,
    level: 'none'
  });
  
  React.useEffect(() => {
    const handleIsolationEvent = (event: CustomEvent) => {
      if (event.detail.componentId === componentId) {
        setIsolationState({
          isIsolated: event.detail.action === 'isolated',
          level: event.detail.level
        });
      }
    };
    
    window.addEventListener('component-isolation', handleIsolationEvent as any);
    
    return () => {
      window.removeEventListener('component-isolation', handleIsolationEvent as any);
    };
  }, [componentId]);
  
  return isolationState;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_ISOLATION_CONFIG: IsolationConfig = {
  timing: {
    evaluationIntervalMs: 250,
    cooldownMs: 5000,
    restoreDelayMs: 2000,
  },
  
  thresholds: {
    frameBudgetMs: 16.67,
    minFPS: 30,
    maxRenderMs: 50,
    consecutiveBadFrames: 3,
    healthScoreThreshold: 3.0,
  },
  
  budgets: {
    maxEventListeners: 100,
    maxDOMNodes: 1000,
    maxCanvasPixels: 4_000_000,
    maxTimers: 20,
  },
  
  isolation: {
    maxIsolatedComponents: 3,
    neverIsolate: ['main'],
    priorityOrder: ['low', 'normal', 'high', 'critical'],
    autoRestore: true,
  },
};

// Note: React import would be added at the top in actual implementation
declare const React: any;