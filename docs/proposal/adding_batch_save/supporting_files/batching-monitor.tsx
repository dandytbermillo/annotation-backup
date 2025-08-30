'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface BatchingMetrics {
  totalUpdates: number     // Total updates processed
  totalBatches: number     // Total batches flushed
  averageBatchSize: number // Average updates per batch
  compressionRatio: number // Compression achieved
  flushReasons?: {
    timeout: number
    size: number
    count: number
    manual: number
    shutdown: number
  }
}

export function BatchingMonitor() {
  const [metrics, setMetrics] = useState<BatchingMetrics | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      const provider = (window as any).yjsProvider
      if (provider?.getBatchingMetrics) {
        const newMetrics = provider.getBatchingMetrics()
        if (newMetrics) {
          setMetrics(newMetrics)
          setIsVisible(true)
        }
      }
    }, 1000) // Update every second

    return () => clearInterval(interval)
  }, [])

  if (!isVisible || !metrics) return null

  return (
    <Card className="fixed bottom-4 right-4 w-80 shadow-lg z-50 bg-white/90 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Batching Metrics</CardTitle>
      </CardHeader>
      <CardContent className="text-xs space-y-1">
        <div className="flex justify-between">
          <span>Total Updates:</span>
          <span className="font-mono">{metrics.totalUpdates}</span>
        </div>
        <div className="flex justify-between">
          <span>Batches Flushed:</span>
          <span className="font-mono">{metrics.totalBatches}</span>
        </div>
        <div className="flex justify-between">
          <span>Avg Batch Size:</span>
          <span className="font-mono">{metrics.averageBatchSize.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span>Compression Ratio:</span>
          <span className="font-mono">{metrics.compressionRatio.toFixed(2)}x</span>
        </div>
        <div className="flex justify-between">
          <span>Write Reduction:</span>
          <span className="font-mono text-green-600">
            {metrics.totalUpdates > 0 
              ? ((1 - metrics.totalBatches / metrics.totalUpdates) * 100).toFixed(1) + '%'
              : '0%'}
          </span>
        </div>
        {metrics.flushReasons && (
          <div className="pt-1 text-[10px] opacity-70">
            Flush reasons: timeout({metrics.flushReasons.timeout}) 
            size({metrics.flushReasons.size}) 
            count({metrics.flushReasons.count})
          </div>
        )}
      </CardContent>
    </Card>
  )
}