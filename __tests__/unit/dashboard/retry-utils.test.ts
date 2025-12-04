/**
 * Unit Tests: Dashboard Retry Utilities
 * Part of Dashboard Implementation - Phase 5.1
 *
 * Tests exponential backoff retry logic.
 */

import { withRetry, createRetryFetch, initialRetryState } from '@/lib/dashboard/retry-utils'

describe('Dashboard Retry Utilities', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('withRetry', () => {
    it('should return result immediately on success', async () => {
      const fn = jest.fn().mockResolvedValue('success')

      const result = await withRetry(fn)

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure up to maxRetries', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success')

      const resultPromise = withRetry(fn, { maxRetries: 3, initialDelay: 100 })

      // First attempt fails
      await jest.advanceTimersByTimeAsync(0)
      // Wait for first retry delay
      await jest.advanceTimersByTimeAsync(150)
      // Wait for second retry delay
      await jest.advanceTimersByTimeAsync(300)

      const result = await resultPromise

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should throw after maxRetries exceeded', async () => {
      jest.useRealTimers() // Use real timers for this test

      const fn = jest.fn().mockRejectedValue(new Error('persistent failure'))

      await expect(
        withRetry(fn, { maxRetries: 2, initialDelay: 10, maxDelay: 50 })
      ).rejects.toThrow('persistent failure')

      expect(fn).toHaveBeenCalledTimes(3) // Initial + 2 retries

      jest.useFakeTimers() // Restore fake timers
    })

    it('should call onRetry callback on each retry', async () => {
      const onRetry = jest.fn()
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const resultPromise = withRetry(fn, {
        maxRetries: 2,
        initialDelay: 100,
        onRetry,
      })

      await jest.advanceTimersByTimeAsync(200)
      await resultPromise

      expect(onRetry).toHaveBeenCalledTimes(1)
      expect(onRetry).toHaveBeenCalledWith(
        1,
        expect.any(Error),
        expect.any(Number)
      )
    })

    it('should apply exponential backoff', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success')

      const delays: number[] = []
      const onRetry = jest.fn((_attempt, _error, delay) => {
        delays.push(delay)
      })

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelay: 100,
        backoffFactor: 2,
        onRetry,
      })

      await jest.advanceTimersByTimeAsync(1000)
      await resultPromise

      // First delay should be around 100ms, second around 200ms (with jitter)
      expect(delays[0]).toBeGreaterThanOrEqual(100)
      expect(delays[0]).toBeLessThan(150)
      expect(delays[1]).toBeGreaterThanOrEqual(200)
    })

    it('should respect maxDelay cap', async () => {
      jest.useRealTimers() // Use real timers for this test

      const fn = jest.fn().mockRejectedValue(new Error('fail'))

      const delays: number[] = []
      const onRetry = jest.fn((_attempt, _error, delay) => {
        delays.push(delay)
      })

      await expect(
        withRetry(fn, {
          maxRetries: 3,
          initialDelay: 10,
          maxDelay: 50,
          backoffFactor: 3,
          onRetry,
        })
      ).rejects.toThrow()

      // All delays should be capped at maxDelay (with jitter allowance)
      delays.forEach(delay => {
        expect(delay).toBeLessThanOrEqual(65) // maxDelay + 30% jitter
      })

      jest.useFakeTimers() // Restore fake timers
    })
  })

  describe('createRetryFetch', () => {
    beforeEach(() => {
      global.fetch = jest.fn()
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should fetch successfully and return JSON', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'test' }),
      })

      const retryFetch = createRetryFetch()
      const result = await retryFetch('/api/test')

      expect(result).toEqual({ data: 'test' })
      expect(global.fetch).toHaveBeenCalledWith('/api/test', undefined)
    })

    it('should retry on HTTP errors', async () => {
      ;(global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Server error' }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({ success: true }),
        })

      const retryFetch = createRetryFetch({ maxRetries: 2, initialDelay: 50 })
      const resultPromise = retryFetch('/api/test')

      await jest.advanceTimersByTimeAsync(200)
      const result = await resultPromise

      expect(result).toEqual({ success: true })
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('should pass fetch options through', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })

      const retryFetch = createRetryFetch()
      await retryFetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' }),
      })

      expect(global.fetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' }),
      })
    })
  })

  describe('initialRetryState', () => {
    it('should have correct initial values', () => {
      expect(initialRetryState).toEqual({
        isRetrying: false,
        retryCount: 0,
        lastError: null,
        canRetry: true,
      })
    })
  })
})
