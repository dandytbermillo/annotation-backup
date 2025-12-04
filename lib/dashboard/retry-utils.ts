/**
 * Dashboard Retry Utilities
 * Part of Dashboard Implementation - Phase 4.3
 *
 * Provides retry logic with exponential backoff for dashboard operations.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number
  /** Initial delay in milliseconds */
  initialDelay?: number
  /** Maximum delay in milliseconds */
  maxDelay?: number
  /** Backoff multiplier */
  backoffFactor?: number
  /** Callback called on each retry */
  onRetry?: (attempt: number, error: Error, delay: number) => void
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
}

/**
 * Execute an async function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    initialDelay = DEFAULT_OPTIONS.initialDelay,
    maxDelay = DEFAULT_OPTIONS.maxDelay,
    backoffFactor = DEFAULT_OPTIONS.backoffFactor,
    onRetry,
  } = options

  let lastError: Error | null = null
  let delay = initialDelay

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (attempt < maxRetries) {
        // Calculate next delay with jitter
        const jitter = Math.random() * 0.3 * delay
        const actualDelay = Math.min(delay + jitter, maxDelay)

        onRetry?.(attempt + 1, lastError, actualDelay)

        await sleep(actualDelay)
        delay = Math.min(delay * backoffFactor, maxDelay)
      }
    }
  }

  throw lastError || new Error('Operation failed after retries')
}

/**
 * Create a retry wrapper for fetch operations
 */
export function createRetryFetch(options: RetryOptions = {}) {
  return async <T>(
    url: string,
    fetchOptions?: RequestInit
  ): Promise<T> => {
    return withRetry(async () => {
      const response = await fetch(url, fetchOptions)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }
      return response.json()
    }, options)
  }
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry state for UI components
 */
export interface RetryState {
  isRetrying: boolean
  retryCount: number
  lastError: string | null
  canRetry: boolean
}

export const initialRetryState: RetryState = {
  isRetrying: false,
  retryCount: 0,
  lastError: null,
  canRetry: true,
}
