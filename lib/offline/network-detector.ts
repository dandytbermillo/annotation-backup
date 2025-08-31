/**
 * Network Detector for Unified Offline Foundation
 * 
 * Smart connectivity detection with:
 * - Active reachability probes
 * - RTT measurement
 * - Quality assessment (good/degraded/offline)
 * - Exponential backoff
 */

import { telemetry } from './telemetry';
import { getFeatureFlag } from './feature-flags';

export type NetworkQuality = 'good' | 'degraded' | 'offline';

interface NetworkDetectorConfig {
  healthEndpoint: string;
  probeTimeout: number; // ms
  probeInterval: number; // ms
  rttThresholds: {
    good: number; // < this = good
    degraded: number; // < this = degraded, else offline
  };
  minSamples: number; // Minimum samples for RTT calculation
}

const DEFAULT_CONFIG: NetworkDetectorConfig = {
  healthEndpoint: '/api/health',
  probeTimeout: 2000, // 2 seconds
  probeInterval: 30000, // 30 seconds
  rttThresholds: {
    good: 100, // < 100ms = good
    degraded: 500, // 100-500ms = degraded
  },
  minSamples: 3,
};

export class NetworkDetector {
  private config: NetworkDetectorConfig;
  private rttSamples: number[] = [];
  private lastProbeTime = 0;
  private probeTimer?: NodeJS.Timeout;
  private currentQuality: NetworkQuality = 'good';
  private listeners: Set<(quality: NetworkQuality) => void> = new Set();
  private isProbing = false;

  constructor(config: Partial<NetworkDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Listen to browser online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.probe());
      window.addEventListener('offline', () => this.updateQuality('offline'));
    }
  }

  /**
   * Start periodic probing
   */
  start(): void {
    if (!getFeatureFlag('offline.circuitBreaker')) {
      return; // Feature disabled
    }
    
    this.probe(); // Initial probe
    this.probeTimer = setInterval(() => {
      this.probe();
    }, this.config.probeInterval);
  }

  /**
   * Stop periodic probing
   */
  stop(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = undefined;
    }
  }

  /**
   * Perform a network probe
   */
  async probe(): Promise<NetworkQuality> {
    if (this.isProbing) {
      return this.currentQuality; // Avoid concurrent probes
    }
    
    this.isProbing = true;
    const startTime = performance.now();
    
    try {
      // Check browser online status first
      if (typeof window !== 'undefined' && !navigator.onLine) {
        this.updateQuality('offline');
        return 'offline';
      }
      
      // Active probe to health endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.probeTimeout
      );
      
      const response = await fetch(this.config.healthEndpoint, {
        method: 'HEAD', // Lightweight
        signal: controller.signal,
        cache: 'no-store', // Bypass cache
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        this.updateQuality('degraded');
        return 'degraded';
      }
      
      // Calculate RTT
      const rtt = performance.now() - startTime;
      this.addRttSample(rtt);
      
      // Determine quality based on RTT
      const avgRtt = this.getAverageRtt();
      let quality: NetworkQuality;
      
      if (avgRtt < this.config.rttThresholds.good) {
        quality = 'good';
      } else if (avgRtt < this.config.rttThresholds.degraded) {
        quality = 'degraded';
      } else {
        quality = 'offline';
      }
      
      this.updateQuality(quality);
      this.lastProbeTime = Date.now();
      
      // Track metrics
      telemetry.trackNetwork({
        rtt: avgRtt,
        quality,
        probeSuccessRate: 1,
        lastProbeTime: this.lastProbeTime,
      });
      
      return quality;
    } catch (error) {
      // Network error or timeout
      this.updateQuality('offline');
      
      telemetry.trackNetwork({
        quality: 'offline',
        probeSuccessRate: 0,
        lastProbeTime: Date.now(),
      });
      
      return 'offline';
    } finally {
      this.isProbing = false;
    }
  }

  /**
   * Add RTT sample and maintain rolling window
   */
  private addRttSample(rtt: number): void {
    this.rttSamples.push(rtt);
    // Keep last N samples
    if (this.rttSamples.length > this.config.minSamples * 2) {
      this.rttSamples.shift();
    }
  }

  /**
   * Get average RTT from samples
   */
  private getAverageRtt(): number {
    if (this.rttSamples.length === 0) {
      return 0;
    }
    const sum = this.rttSamples.reduce((a, b) => a + b, 0);
    return sum / this.rttSamples.length;
  }

  /**
   * Update network quality and notify listeners
   */
  private updateQuality(quality: NetworkQuality): void {
    if (this.currentQuality !== quality) {
      this.currentQuality = quality;
      this.notifyListeners(quality);
    }
  }

  /**
   * Notify all listeners of quality change
   */
  private notifyListeners(quality: NetworkQuality): void {
    this.listeners.forEach(listener => {
      try {
        listener(quality);
      } catch (error) {
        console.error('Network detector listener error:', error);
      }
    });
  }

  /**
   * Get current network quality
   */
  getQuality(): NetworkQuality {
    return this.currentQuality;
  }

  /**
   * Get average RTT
   */
  getRtt(): number {
    return this.getAverageRtt();
  }

  /**
   * Check if online (good or degraded)
   */
  isOnline(): boolean {
    return this.currentQuality !== 'offline';
  }

  /**
   * Add quality change listener
   */
  onQualityChange(listener: (quality: NetworkQuality) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Force a probe immediately
   */
  async forceProbe(): Promise<NetworkQuality> {
    return this.probe();
  }

  /**
   * Get last probe time
   */
  getLastProbeTime(): number {
    return this.lastProbeTime;
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.rttSamples = [];
    this.currentQuality = 'good';
    this.lastProbeTime = 0;
  }
}

// Singleton instance
let networkDetectorInstance: NetworkDetector | null = null;

/**
 * Get network detector instance
 */
export function getNetworkDetector(): NetworkDetector {
  if (!networkDetectorInstance) {
    networkDetectorInstance = new NetworkDetector();
  }
  return networkDetectorInstance;
}

// Export convenience functions
export const networkDetector = {
  start: () => getNetworkDetector().start(),
  stop: () => getNetworkDetector().stop(),
  probe: () => getNetworkDetector().probe(),
  getQuality: () => getNetworkDetector().getQuality(),
  getRtt: () => getNetworkDetector().getRtt(),
  isOnline: () => getNetworkDetector().isOnline(),
  onQualityChange: (listener: (quality: NetworkQuality) => void) =>
    getNetworkDetector().onQualityChange(listener),
};