export interface PlainBatchConfig {
  // Batch size limits
  maxBatchSize: number           // Maximum operations per batch
  maxBatchSizeBytes: number      // Maximum batch size in bytes
  
  // Timing
  batchTimeout: number           // Maximum time before flush (ms)
  debounceMs: number            // Debounce time for rapid updates (ms)
  
  // Behavior
  coalesce: boolean             // Enable operation coalescing
  preserveOrder?: boolean       // Maintain operation order per entity
  
  // Retry configuration
  retryAttempts: number         // Number of retry attempts
  retryBackoff: number[]        // Backoff delays in ms
  
  // Offline behavior
  offlineQueueLimit?: number    // Maximum offline queue size
  persistQueue?: boolean        // Persist queue to localStorage
  
  // Development
  debug?: boolean              // Enable debug logging
  monitor?: boolean            // Enable batch monitor UI
}

// Default configurations for different environments
export const PLAIN_BATCH_CONFIGS = {
  // Development configuration - aggressive batching for testing
  development: {
    maxBatchSize: 10,
    maxBatchSizeBytes: 102400, // 100KB
    batchTimeout: 3000,  // wait up to 3s before forced flush
    debounceMs: 800,     // require 800ms idle before flush
    coalesce: true,
    preserveOrder: true,
    retryAttempts: 3,
    retryBackoff: [500, 1000, 2000] as number[],
    offlineQueueLimit: 100,
    persistQueue: true,
    debug: true,
    monitor: true
  },
  
  // Production web configuration
  production_web: {
    maxBatchSize: 50,
    maxBatchSizeBytes: 512000, // 500KB
    batchTimeout: 5000,  // 5s forced flush
    debounceMs: 1000,    // 1s idle window
    coalesce: true,
    preserveOrder: true,
    retryAttempts: 3,
    retryBackoff: [1000, 2000, 4000] as number[],
    offlineQueueLimit: 500,
    persistQueue: true,
    debug: false,
    monitor: false
  },
  
  // Electron configuration - more aggressive batching
  electron: {
    maxBatchSize: 100,
    maxBatchSizeBytes: 1048576, // 1MB
    batchTimeout: 2000,
    debounceMs: 300,
    coalesce: true,
    preserveOrder: true,
    retryAttempts: 5,
    retryBackoff: [1000, 2000, 4000, 8000, 16000] as number[],
    offlineQueueLimit: 1000,
    persistQueue: true,
    debug: false,
    monitor: false
  },
  
  // Test configuration - immediate flushing
  test: {
    maxBatchSize: 1,
    maxBatchSizeBytes: 10240, // 10KB
    batchTimeout: 0,
    debounceMs: 0,
    coalesce: false,
    preserveOrder: true,
    retryAttempts: 0,
    retryBackoff: [] as number[],
    offlineQueueLimit: 10,
    persistQueue: false,
    debug: true,
    monitor: false
  }
} as const

export function getPlainBatchConfig(env?: string): PlainBatchConfig {
  const environment = env || process.env.NODE_ENV || 'development'
  
  // Check if running in Electron
  if (typeof window !== 'undefined' && (window as any).electron) {
    return PLAIN_BATCH_CONFIGS.electron
  }
  
  switch (environment) {
    case 'production':
      return PLAIN_BATCH_CONFIGS.production_web
    case 'test':
      return PLAIN_BATCH_CONFIGS.test
    default:
      return PLAIN_BATCH_CONFIGS.development
  }
}

// Helper to merge user config with defaults
export function mergeConfig(
  userConfig?: Partial<PlainBatchConfig>,
  baseConfig?: PlainBatchConfig
): PlainBatchConfig {
  const base = baseConfig || getPlainBatchConfig()
  return {
    ...base,
    ...userConfig
  }
}