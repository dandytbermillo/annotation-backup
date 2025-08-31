/**
 * Network Service - Integrates Network Detector and Circuit Breaker
 * Phase 1: Connectivity Foundation
 */

import { NetworkDetector, NetworkQuality, networkDetector } from './network-detector';
import { CircuitBreaker, CircuitState, circuitBreaker } from './circuit-breaker';
import { telemetry } from './telemetry';
import { getFeatureFlag } from './feature-flags';

export interface NetworkStatus {
  quality: NetworkQuality;
  circuitState: CircuitState;
  rtt: number;
  isOnline: boolean;
  lastProbeTime: number;
  queueDepth: number;
  lastSyncTime: number;
}

class NetworkService {
  private detector: NetworkDetector;
  private breaker: CircuitBreaker;
  private statusListeners: Set<(status: NetworkStatus) => void> = new Set();
  private queueDepth = 0;
  private lastSyncTime = Date.now();
  private started = false;

  constructor() {
    this.detector = new NetworkDetector();
    this.breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      halfOpenDelay: 10000, // 10s
      backoffMultiplier: 2,
      maxBackoff: 30000, // 30s
      initialBackoff: 1000, // 1s
    });

    // Listen to network quality changes
    this.detector.onQualityChange((quality) => {
      this.notifyStatusChange();
      
      // If offline, open circuit breaker
      if (quality === 'offline') {
        this.breaker.forceOpen();
      } else if (quality === 'good') {
        // If good quality and breaker is open, try half-open
        if (this.breaker.getState() === 'open') {
          setTimeout(() => {
            this.breaker.forceClose(); // Allow retries
          }, 5000);
        }
      }
    });

    // Listen to circuit breaker state changes
    this.breaker.onStateChange((state) => {
      this.notifyStatusChange();
      
      telemetry.track({
        category: 'network',
        action: 'circuit-state-change',
        label: state,
        metadata: {
          failureCount: this.breaker.getFailureCount(),
          backoff: this.breaker.getBackoff(),
        }
      });
    });
  }

  /**
   * Start the network service
   */
  start(): void {
    if (!getFeatureFlag('offline.circuitBreaker')) {
      console.log('[NetworkService] Circuit breaker flag disabled');
      return;
    }

    if (this.started) return;
    
    this.started = true;
    this.detector.start();
    
    // Initial probe
    this.probe();
    
    console.log('[NetworkService] Started');
  }

  /**
   * Stop the network service
   */
  stop(): void {
    this.started = false;
    this.detector.stop();
    console.log('[NetworkService] Stopped');
  }

  /**
   * Perform a network probe through circuit breaker
   */
  async probe(): Promise<NetworkQuality> {
    try {
      const quality = await this.breaker.execute(
        () => this.detector.probe(),
        () => 'offline' as NetworkQuality // Fallback when circuit is open
      );
      
      // Track successful probe
      if (quality !== 'offline') {
        this.breaker.recordSuccess();
      }
      
      return quality;
    } catch (error) {
      // Track failed probe
      this.breaker.recordFailure();
      
      telemetry.track({
        category: 'network',
        action: 'probe-error',
        metadata: { error: String(error) }
      });
      
      return 'offline';
    }
  }

  /**
   * Execute a network request through the circuit breaker
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T> {
    if (!getFeatureFlag('offline.circuitBreaker')) {
      // Feature disabled, execute directly
      return fn();
    }

    return this.breaker.execute(fn, fallback);
  }

  /**
   * Get current network status
   */
  getStatus(): NetworkStatus {
    return {
      quality: this.detector.getQuality(),
      circuitState: this.breaker.getState(),
      rtt: this.detector.getRtt(),
      isOnline: this.detector.isOnline(),
      lastProbeTime: this.detector.getLastProbeTime(),
      queueDepth: this.queueDepth,
      lastSyncTime: this.lastSyncTime,
    };
  }

  /**
   * Update queue depth
   */
  updateQueueDepth(depth: number): void {
    this.queueDepth = depth;
    this.notifyStatusChange();
    
    telemetry.trackQueue({
      depth,
      lastSyncTime: this.lastSyncTime,
    });
  }

  /**
   * Update last sync time
   */
  updateLastSyncTime(time: number = Date.now()): void {
    this.lastSyncTime = time;
    this.notifyStatusChange();
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(listener: (status: NetworkStatus) => void): () => void {
    this.statusListeners.add(listener);
    // Immediately notify with current status
    listener(this.getStatus());
    
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.statusListeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('[NetworkService] Listener error:', error);
      }
    });
  }

  /**
   * Force circuit breaker open (for testing)
   */
  forceCircuitOpen(): void {
    this.breaker.forceOpen();
  }

  /**
   * Force circuit breaker closed (for testing)
   */
  forceCircuitClosed(): void {
    this.breaker.forceClose();
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitStats() {
    return this.breaker.getStats();
  }
}

// Singleton instance
let networkServiceInstance: NetworkService | null = null;

/**
 * Get network service instance
 */
export function getNetworkService(): NetworkService {
  if (!networkServiceInstance) {
    networkServiceInstance = new NetworkService();
  }
  return networkServiceInstance;
}

// Export convenience functions
export const networkService = {
  start: () => getNetworkService().start(),
  stop: () => getNetworkService().stop(),
  probe: () => getNetworkService().probe(),
  execute: <T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>) =>
    getNetworkService().execute(fn, fallback),
  getStatus: () => getNetworkService().getStatus(),
  updateQueueDepth: (depth: number) => getNetworkService().updateQueueDepth(depth),
  updateLastSyncTime: (time?: number) => getNetworkService().updateLastSyncTime(time),
  onStatusChange: (listener: (status: NetworkStatus) => void) =>
    getNetworkService().onStatusChange(listener),
  forceCircuitOpen: () => getNetworkService().forceCircuitOpen(),
  forceCircuitClosed: () => getNetworkService().forceCircuitClosed(),
  getCircuitStats: () => getNetworkService().getCircuitStats(),
};

export type { NetworkStatus };