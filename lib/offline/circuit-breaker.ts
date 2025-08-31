/**
 * Circuit Breaker for Unified Offline Foundation
 * 
 * Prevents cascade failures with:
 * - Open after N consecutive failures
 * - Half-open for testing recovery
 * - Exponential backoff
 * - Close after M successes
 */

import { telemetry } from './telemetry';
import { getFeatureFlag } from './feature-flags';

export type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  failureThreshold: number; // Failures to open
  successThreshold: number; // Successes to close
  halfOpenDelay: number; // ms before half-open
  backoffMultiplier: number; // Backoff factor
  maxBackoff: number; // Max backoff ms
  initialBackoff: number; // Initial backoff ms
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3, // Open after 3 failures
  successThreshold: 2, // Close after 2 successes
  halfOpenDelay: 10000, // 10 seconds
  backoffMultiplier: 2, // Double each time
  maxBackoff: 30000, // Cap at 30 seconds
  initialBackoff: 1000, // Start at 1 second
};

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastStateChange = Date.now();
  private currentBackoff: number;
  private halfOpenTimer?: NodeJS.Timeout;
  private listeners: Set<(state: CircuitState) => void> = new Set();

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentBackoff = this.config.initialBackoff;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T> {
    if (!getFeatureFlag('offline.circuitBreaker')) {
      // Feature disabled, execute directly
      return fn();
    }

    // Check circuit state
    if (this.state === 'open') {
      // Circuit is open, check if we should try half-open
      if (this.shouldAttemptHalfOpen()) {
        this.transitionTo('half-open');
      } else {
        // Still open, use fallback or throw
        if (fallback) {
          return fallback();
        }
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      // Execute the function
      const result = await fn();
      
      // Record success
      this.recordSuccess();
      
      return result;
    } catch (error) {
      // Record failure
      this.recordFailure();
      
      // Use fallback if available
      if (fallback) {
        return fallback();
      }
      
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.failureCount = 0; // Reset failure count
    
    if (this.state === 'half-open') {
      this.successCount++;
      
      if (this.successCount >= this.config.successThreshold) {
        // Enough successes, close the circuit
        this.transitionTo('closed');
        this.successCount = 0;
        this.currentBackoff = this.config.initialBackoff; // Reset backoff
      }
    }
    
    // Track metrics
    telemetry.trackNetwork({
      breakerState: this.state,
    });
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === 'half-open') {
      // Failed in half-open, go back to open
      this.transitionTo('open');
      this.increaseBackoff();
    } else if (
      this.state === 'closed' &&
      this.failureCount >= this.config.failureThreshold
    ) {
      // Too many failures, open the circuit
      this.transitionTo('open');
    }
    
    // Track metrics
    telemetry.trackNetwork({
      breakerState: this.state,
    });
  }

  /**
   * Check if we should attempt half-open
   */
  private shouldAttemptHalfOpen(): boolean {
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    return timeSinceLastFailure >= this.currentBackoff;
  }

  /**
   * Increase backoff with exponential growth
   */
  private increaseBackoff(): void {
    this.currentBackoff = Math.min(
      this.currentBackoff * this.config.backoffMultiplier,
      this.config.maxBackoff
    );
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;
    
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    
    // Clear any existing timer
    if (this.halfOpenTimer) {
      clearTimeout(this.halfOpenTimer);
      this.halfOpenTimer = undefined;
    }
    
    // Set timer for half-open if transitioning to open
    if (newState === 'open') {
      this.halfOpenTimer = setTimeout(() => {
        if (this.state === 'open') {
          this.transitionTo('half-open');
        }
      }, this.config.halfOpenDelay);
    }
    
    // Reset counters on state change
    if (newState === 'closed') {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === 'half-open') {
      this.successCount = 0;
    }
    
    // Notify listeners
    this.notifyListeners(newState);
    
    // Log state change
    console.log(`[CircuitBreaker] ${oldState} → ${newState}`);
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(state: CircuitState): void {
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('Circuit breaker listener error:', error);
      }
    });
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get current backoff
   */
  getBackoff(): number {
    return this.currentBackoff;
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Check if circuit allows requests
   */
  isAllowing(): boolean {
    return this.state !== 'open' || this.shouldAttemptHalfOpen();
  }

  /**
   * Add state change listener
   */
  onStateChange(listener: (state: CircuitState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Force open the circuit
   */
  forceOpen(): void {
    this.transitionTo('open');
  }

  /**
   * Force close the circuit
   */
  forceClose(): void {
    this.transitionTo('closed');
    this.failureCount = 0;
    this.successCount = 0;
    this.currentBackoff = this.config.initialBackoff;
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.forceClose();
  }

  /**
   * Get statistics
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    currentBackoff: number;
    lastFailureTime: number;
    lastStateChange: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      currentBackoff: this.currentBackoff,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
    };
  }
}

// Singleton instance for main circuit
let mainCircuitBreaker: CircuitBreaker | null = null;

/**
 * Get main circuit breaker instance
 */
export function getCircuitBreaker(): CircuitBreaker {
  if (!mainCircuitBreaker) {
    mainCircuitBreaker = new CircuitBreaker();
  }
  return mainCircuitBreaker;
}

// Export convenience functions
export const circuitBreaker = {
  execute: <T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>) =>
    getCircuitBreaker().execute(fn, fallback),
  getState: () => getCircuitBreaker().getState(),
  isAllowing: () => getCircuitBreaker().isAllowing(),
  onStateChange: (listener: (state: CircuitState) => void) =>
    getCircuitBreaker().onStateChange(listener),
  reset: () => getCircuitBreaker().reset(),
  getStats: () => getCircuitBreaker().getStats(),
};