/**
 * Telemetry System for Unified Offline Foundation
 * 
 * Captures metrics for:
 * - Network connectivity (RTT, quality, breaker state)
 * - Cache performance (hits/misses, size, evictions)
 * - Queue operations (processed, failed, expired)
 * - Conflict resolution (occurrences, actions, outcomes)
 */

interface TelemetryEvent {
  timestamp: number;
  category: 'network' | 'cache' | 'queue' | 'conflict' | 'error';
  action: string;
  label?: string;
  value?: number;
  metadata?: Record<string, any>;
}

interface NetworkMetrics {
  rtt: number; // Round-trip time in ms
  quality: 'good' | 'degraded' | 'offline';
  breakerState: 'closed' | 'open' | 'half-open';
  probeSuccessRate: number; // 0-1
  lastProbeTime: number;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  sizeBytes: number;
  evictions: number;
  namespace: 'docs' | 'lists' | 'search';
}

interface QueueMetrics {
  depth: number;
  processed: number;
  failed: number;
  expired: number;
  deadLetterCount: number;
  lastSyncTime: number;
}

interface ConflictMetrics {
  occurrences: number;
  resolutionType: 'mine' | 'theirs' | 'merge' | 'force';
  successRate: number;
  repeatConflicts: number;
}

class TelemetryService {
  private events: TelemetryEvent[] = [];
  private maxEvents = 1000; // Circular buffer size
  private batchSize = 50;
  private flushInterval = 30000; // 30 seconds
  private flushTimer?: NodeJS.Timeout;
  private endpoint = '/api/telemetry';
  
  // Current metrics (for dashboard display)
  public networkMetrics: NetworkMetrics = {
    rtt: 0,
    quality: 'good',
    breakerState: 'closed',
    probeSuccessRate: 1,
    lastProbeTime: Date.now(),
  };
  
  public cacheMetrics: Record<string, CacheMetrics> = {
    docs: { hits: 0, misses: 0, sizeBytes: 0, evictions: 0, namespace: 'docs' },
    lists: { hits: 0, misses: 0, sizeBytes: 0, evictions: 0, namespace: 'lists' },
    search: { hits: 0, misses: 0, sizeBytes: 0, evictions: 0, namespace: 'search' },
  };
  
  public queueMetrics: QueueMetrics = {
    depth: 0,
    processed: 0,
    failed: 0,
    expired: 0,
    deadLetterCount: 0,
    lastSyncTime: Date.now(),
  };
  
  public conflictMetrics: ConflictMetrics = {
    occurrences: 0,
    resolutionType: 'mine',
    successRate: 1,
    repeatConflicts: 0,
  };

  constructor() {
    if (typeof window !== 'undefined') {
      // Client-side: start flush timer
      this.startFlushTimer();
      
      // Flush on page unload
      window.addEventListener('beforeunload', () => {
        this.flush(true); // Synchronous flush
      });
    }
  }

  /**
   * Track a telemetry event
   */
  track(event: Omit<TelemetryEvent, 'timestamp'>): void {
    const fullEvent: TelemetryEvent = {
      ...event,
      timestamp: Date.now(),
    };
    
    this.events.push(fullEvent);
    
    // Circular buffer: remove oldest if over limit
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    
    // Update metrics based on event
    this.updateMetrics(fullEvent);
    
    // Auto-flush if batch size reached
    if (this.events.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Track network metrics
   */
  trackNetwork(metrics: Partial<NetworkMetrics>): void {
    this.networkMetrics = { ...this.networkMetrics, ...metrics };
    this.track({
      category: 'network',
      action: 'update',
      metadata: metrics,
    });
  }

  /**
   * Track cache metrics
   */
  trackCache(namespace: string, metrics: Partial<CacheMetrics>): void {
    if (namespace in this.cacheMetrics) {
      this.cacheMetrics[namespace] = { 
        ...this.cacheMetrics[namespace], 
        ...metrics 
      };
    }
    this.track({
      category: 'cache',
      action: namespace,
      metadata: metrics,
    });
  }

  /**
   * Track queue metrics
   */
  trackQueue(metrics: Partial<QueueMetrics>): void {
    this.queueMetrics = { ...this.queueMetrics, ...metrics };
    this.track({
      category: 'queue',
      action: 'update',
      metadata: metrics,
    });
  }

  /**
   * Track conflict metrics
   */
  trackConflict(action: string, metadata?: Record<string, any>): void {
    this.conflictMetrics.occurrences++;
    this.track({
      category: 'conflict',
      action,
      metadata,
    });
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): {
    network: NetworkMetrics;
    cache: Record<string, CacheMetrics>;
    queue: QueueMetrics;
    conflict: ConflictMetrics;
  } {
    return {
      network: { ...this.networkMetrics },
      cache: { ...this.cacheMetrics },
      queue: { ...this.queueMetrics },
      conflict: { ...this.conflictMetrics },
    };
  }

  /**
   * Update metrics from event
   */
  private updateMetrics(event: TelemetryEvent): void {
    // Log to console in dev mode
    if (process.env.NODE_ENV === 'development') {
      console.log('[Telemetry]', event);
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * Flush events to server
   */
  async flush(synchronous = false): Promise<void> {
    if (this.events.length === 0) return;
    
    const eventsToSend = [...this.events];
    this.events = [];
    
    const payload = {
      events: eventsToSend,
      metrics: this.getMetrics(),
      timestamp: Date.now(),
    };
    
    if (synchronous && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      // Use sendBeacon for synchronous flush (page unload)
      navigator.sendBeacon(this.endpoint, JSON.stringify(payload));
    } else {
      // Async flush
      try {
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        // Re-queue events on failure
        this.events.unshift(...eventsToSend);
        console.error('[Telemetry] Flush failed:', error);
      }
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.events = [];
    // Reset metrics to defaults
    this.networkMetrics.probeSuccessRate = 1;
    this.networkMetrics.quality = 'good';
    this.networkMetrics.breakerState = 'closed';
    Object.values(this.cacheMetrics).forEach(m => {
      m.hits = 0;
      m.misses = 0;
      m.evictions = 0;
    });
  }

  /**
   * Destroy telemetry service
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush(true);
  }
}

// Singleton instance
let telemetryInstance: TelemetryService | null = null;

/**
 * Get telemetry service instance
 */
export function getTelemetry(): TelemetryService {
  if (!telemetryInstance) {
    telemetryInstance = new TelemetryService();
  }
  return telemetryInstance;
}

// Export types
export type { 
  TelemetryEvent, 
  NetworkMetrics, 
  CacheMetrics, 
  QueueMetrics, 
  ConflictMetrics 
};

// Convenience tracking functions
export const telemetry = {
  trackNetwork: (metrics: Partial<NetworkMetrics>) => 
    getTelemetry().trackNetwork(metrics),
  
  trackCache: (namespace: string, metrics: Partial<CacheMetrics>) => 
    getTelemetry().trackCache(namespace, metrics),
  
  trackQueue: (metrics: Partial<QueueMetrics>) => 
    getTelemetry().trackQueue(metrics),
  
  trackConflict: (action: string, metadata?: Record<string, any>) => 
    getTelemetry().trackConflict(action, metadata),
  
  track: (event: Omit<TelemetryEvent, 'timestamp'>) => 
    getTelemetry().track(event),
  
  getMetrics: () => getTelemetry().getMetrics(),
  
  flush: () => getTelemetry().flush(),
};