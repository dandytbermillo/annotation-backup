'use client'

import React, { useState, useEffect } from 'react'
import { PlainBatchManager } from '@/lib/batching/plain-batch-manager'
import { PlainOfflineQueue } from '@/lib/batching/plain-offline-queue'

interface BatchMetrics {
  totalQueued: number
  totalFlushed: number
  totalCoalesced: number
  averageFlushSize: number
  lastFlushTime: number
  queueStatus: Map<string, { size: number; operations: number }>
  offlineQueueSize: number
  isOnline: boolean
}

interface BatchMonitorProps {
  batchManager?: PlainBatchManager
  offlineQueue?: PlainOfflineQueue
}

export function BatchMonitor({ 
  batchManager,
  offlineQueue 
}: BatchMonitorProps) {
  const [metrics, setMetrics] = useState<BatchMetrics>({
    totalQueued: 0,
    totalFlushed: 0,
    totalCoalesced: 0,
    averageFlushSize: 0,
    lastFlushTime: 0,
    queueStatus: new Map(),
    offlineQueueSize: 0,
    isOnline: true
  })
  
  const [isMinimized, setIsMinimized] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  
  useEffect(() => {
    if (!batchManager) return
    
    const handleQueuedOperation = () => {
      setMetrics(prev => ({
        ...prev,
        totalQueued: prev.totalQueued + 1
      }))
      updateQueueStatus()
    }
    
    const handleBatchFlushed = ({ count, originalCount, duration }: any) => {
      setMetrics(prev => {
        const totalFlushed = prev.totalFlushed + count
        const coalesced = originalCount - count
        return {
          ...prev,
          totalFlushed,
          totalCoalesced: prev.totalCoalesced + coalesced,
          lastFlushTime: Date.now(),
          averageFlushSize: totalFlushed > 0 
            ? (prev.averageFlushSize * prev.totalFlushed + count) / totalFlushed
            : count
        }
      })
      updateQueueStatus()
    }
    
    const updateQueueStatus = () => {
      if (batchManager) {
        const queues = batchManager.getQueues()
        const status = new Map()
        
        for (const [key, queue] of queues) {
          status.set(key, {
            size: queue.size,
            operations: queue.operations.length
          })
        }
        
        setMetrics(prev => ({
          ...prev,
          queueStatus: status
        }))
      }
    }
    
    batchManager.on('operation-queued', handleQueuedOperation)
    batchManager.on('batch-flushed', handleBatchFlushed)
    
    // Initial status
    updateQueueStatus()
    
    // Update queue status periodically
    const interval = setInterval(updateQueueStatus, 1000)
    
    return () => {
      batchManager.off('operation-queued', handleQueuedOperation)
      batchManager.off('batch-flushed', handleBatchFlushed)
      clearInterval(interval)
    }
  }, [batchManager])
  
  useEffect(() => {
    if (!offlineQueue) return
    
    const handleOffline = () => {
      setMetrics(prev => ({ ...prev, isOnline: false }))
    }
    
    const handleOnline = () => {
      setMetrics(prev => ({ ...prev, isOnline: true }))
    }
    
    const updateOfflineQueueSize = () => {
      const status = offlineQueue.getQueueStatus()
      setMetrics(prev => ({
        ...prev,
        offlineQueueSize: status.size,
        isOnline: status.online
      }))
    }
    
    offlineQueue.on('offline', handleOffline)
    offlineQueue.on('online', handleOnline)
    offlineQueue.on('operation-queued', updateOfflineQueueSize)
    offlineQueue.on('operation-processed', updateOfflineQueueSize)
    
    // Initial status
    updateOfflineQueueSize()
    
    return () => {
      offlineQueue.off('offline', handleOffline)
      offlineQueue.off('online', handleOnline)
      offlineQueue.off('operation-queued', updateOfflineQueueSize)
      offlineQueue.off('operation-processed', updateOfflineQueueSize)
    }
  }, [offlineQueue])
  
  // Only show in development mode
  if (process.env.NODE_ENV === 'production' || !batchManager) {
    return null
  }
  
  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 bg-blue-500 text-white rounded-full w-10 h-10 flex items-center justify-center shadow-lg hover:bg-blue-600 z-50"
        title="Show Batch Monitor"
      >
        📊
      </button>
    )
  }
  
  const coalescingRatio = metrics.totalQueued > 0 
    ? ((metrics.totalCoalesced / metrics.totalQueued) * 100).toFixed(1)
    : '0.0'
    
  const currentQueueSize = Array.from(metrics.queueStatus.values())
    .reduce((sum, status) => sum + status.operations, 0)
  
  return (
    <div className={`fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 
                     ${isMinimized ? 'w-48' : 'w-80'} z-50`}>
      <div className="flex justify-between items-center p-2 border-b bg-gray-50 rounded-t-lg">
        <h3 className="text-sm font-semibold text-gray-700">Batch Monitor</h3>
        <div className="flex gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="text-gray-500 hover:text-gray-700 px-1"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? '▲' : '▼'}
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="text-gray-500 hover:text-gray-700 px-1"
            title="Hide"
          >
            ✕
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <div className="p-3 space-y-3 text-xs">
          {/* Online Status */}
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Status:</span>
            <span className={`flex items-center gap-1 ${metrics.isOnline ? 'text-green-600' : 'text-red-600'}`}>
              <span className={`w-2 h-2 rounded-full ${metrics.isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
              {metrics.isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          
          {/* Current Queue Size */}
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Current Queue:</span>
            <span className={`font-mono ${currentQueueSize > 0 ? 'text-orange-600' : 'text-gray-700'}`}>
              {currentQueueSize}
            </span>
          </div>
          
          {/* Offline Queue */}
          {metrics.offlineQueueSize > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Offline Queue:</span>
              <span className="font-mono text-red-600">{metrics.offlineQueueSize}</span>
            </div>
          )}
          
          {/* Statistics */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
            <div>
              <span className="text-gray-600">Queued:</span>
              <span className="ml-1 font-mono text-gray-700">{metrics.totalQueued}</span>
            </div>
            <div>
              <span className="text-gray-600">Flushed:</span>
              <span className="ml-1 font-mono text-gray-700">{metrics.totalFlushed}</span>
            </div>
            <div>
              <span className="text-gray-600">Coalesced:</span>
              <span className="ml-1 font-mono text-gray-700">{metrics.totalCoalesced}</span>
            </div>
            <div>
              <span className="text-gray-600">Ratio:</span>
              <span className="ml-1 font-mono text-gray-700">{coalescingRatio}%</span>
            </div>
            <div className="col-span-2">
              <span className="text-gray-600">Avg Batch:</span>
              <span className="ml-1 font-mono text-gray-700">
                {metrics.averageFlushSize.toFixed(1)}
              </span>
            </div>
          </div>
          
          {/* Last Flush Time */}
          {metrics.lastFlushTime > 0 && (
            <div className="text-gray-600 pt-2 border-t">
              Last flush: {new Date(metrics.lastFlushTime).toLocaleTimeString()}
            </div>
          )}
          
          {/* Active Queues */}
          {metrics.queueStatus.size > 0 && (
            <div className="pt-2 border-t">
              <div className="text-gray-600 mb-1">Active Queues:</div>
              <div className="space-y-1 max-h-20 overflow-y-auto">
                {Array.from(metrics.queueStatus.entries()).map(([key, status]) => (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="truncate text-gray-500" title={key}>
                      {key.length > 20 ? `...${key.slice(-17)}` : key}
                    </span>
                    <span className="font-mono text-gray-700">{status.operations}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Debug Actions */}
          <div className="flex gap-2 pt-2 border-t">
            <button
              onClick={() => batchManager?.flushAll()}
              className="flex-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              title="Force flush all queues"
            >
              Flush All
            </button>
            <button
              onClick={() => {
                const status = batchManager?.getQueueStatus()
                console.log('Batch Manager Status:', status)
                console.log('Queue Details:', batchManager?.getQueues())
                if (offlineQueue) {
                  console.log('Offline Queue:', offlineQueue.getQueueStatus())
                }
              }}
              className="flex-1 px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
              title="Log status to console"
            >
              Debug
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Export for use in browser console during development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__BatchMonitor = BatchMonitor
}