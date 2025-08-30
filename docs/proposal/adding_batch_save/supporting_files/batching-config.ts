/**
 * Configuration for the batching persistence provider
 */

export interface BatchingConfig {
  /**
   * Maximum number of updates to batch before flushing
   */
  maxBatchSize: number

  /**
   * Maximum size in bytes before flushing the batch
   */
  maxBatchSizeBytes: number

  /**
   * Maximum time in milliseconds to wait before flushing
   */
  batchTimeout: number

  /**
   * Debounce delay in milliseconds to wait after last update
   */
  debounceMs: number

  /**
   * Whether to coalesce updates using Y.mergeUpdates
   */
  coalesce: boolean

  /**
   * Enable debug logging
   */
  debug?: boolean

  /**
   * Disable process/window event listeners (for testing)
   */
  disableEventListeners?: boolean
}

export interface BatchMetrics {
  /**
   * Total number of batches flushed
   */
  totalBatches: number

  /**
   * Total number of updates processed
   */
  totalUpdates: number

  /**
   * Average number of updates per batch
   */
  averageBatchSize: number

  /**
   * Compression ratio achieved through coalescing
   */
  compressionRatio: number

  /**
   * Reasons for flushing batches
   */
  flushReasons: {
    timeout: number
    size: number
    count: number
    manual: number
    shutdown: number
  }

  /**
   * Number of errors encountered
   */
  errors: number

  /**
   * Last error message if any
   */
  lastError?: string
}

export type FlushReason = 'timeout' | 'size' | 'count' | 'manual' | 'shutdown'

/**
 * Web platform configuration - optimized for network latency
 */
export const WEB_CONFIG: BatchingConfig = {
  maxBatchSize: 100,
  maxBatchSizeBytes: 1024 * 1024, // 1MB
  batchTimeout: 2000,              // 2 seconds
  debounceMs: 300,                 // 300ms typing pause
  coalesce: true,
  debug: true                      // Enable debug logging to verify batching
}

/**
 * Electron platform configuration - optimized for local persistence
 */
export const ELECTRON_CONFIG: BatchingConfig = {
  maxBatchSize: 50,
  maxBatchSizeBytes: 256 * 1024,  // 256KB
  batchTimeout: 500,               // 500ms
  debounceMs: 100,                 // 100ms
  coalesce: true,
  debug: false
}

/**
 * Test configuration - fast flushing for tests
 */
export const TEST_CONFIG: BatchingConfig = {
  maxBatchSize: 10,
  maxBatchSizeBytes: 10 * 1024,   // 10KB
  batchTimeout: 100,               // 100ms
  debounceMs: 50,                  // 50ms
  coalesce: true,
  debug: true,
  disableEventListeners: true     // Disable to avoid warnings in tests
}

/**
 * Validate a batching configuration
 */
export function validateConfig(config: BatchingConfig): void {
  if (config.maxBatchSize <= 0) {
    throw new Error('maxBatchSize must be greater than 0')
  }
  if (config.maxBatchSizeBytes <= 0) {
    throw new Error('maxBatchSizeBytes must be greater than 0')
  }
  if (config.batchTimeout <= 0) {
    throw new Error('batchTimeout must be greater than 0')
  }
  if (config.debounceMs < 0) {
    throw new Error('debounceMs must be non-negative')
  }
}

/**
 * Get the default configuration for the current platform
 */
export function getDefaultConfig(): BatchingConfig {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return TEST_CONFIG
  }
  
  if (typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined') {
    return ELECTRON_CONFIG
  }
  
  return WEB_CONFIG
}