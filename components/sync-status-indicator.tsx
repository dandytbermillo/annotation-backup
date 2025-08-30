'use client'

import { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  WifiOff, 
  Wifi, 
  AlertCircle, 
  RefreshCw,
  Download,
  Upload,
  Clock
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface QueueStatus {
  byStatus: Array<{
    status: 'pending' | 'processing' | 'failed'
    count: string
    oldest?: string
    newest?: string
  }>
  expired: number
  deadLetter: number
}

export function SyncStatusIndicator() {
  const [isOnline, setIsOnline] = useState(true)
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [isElectron, setIsElectron] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [showOfflineBanner, setShowOfflineBanner] = useState(false)
  
  // Detect platform
  useEffect(() => {
    const electron = typeof window !== 'undefined' && !!(window as any).electron
    setIsElectron(electron)
    
    // Show offline banner for web mode when offline
    if (!electron && !navigator.onLine) {
      setShowOfflineBanner(true)
    }
  }, [])
  
  // Monitor online status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setShowOfflineBanner(false)
      // Auto-sync when coming back online
      if (isElectron) {
        handleFlushQueue()
      }
    }
    
    const handleOffline = () => {
      setIsOnline(false)
      if (!isElectron) {
        setShowOfflineBanner(true)
      }
    }
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setIsOnline(navigator.onLine)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [isElectron])
  
  // Poll queue status (Electron only)
  useEffect(() => {
    if (!isElectron) return
    
    const fetchQueueStatus = async () => {
      try {
        const result = await (window as any).electron.ipcRenderer.invoke('postgres-offline:queueStatus')
        if (result.success) {
          setQueueStatus(result.data)
        }
      } catch (error) {
        console.error('Failed to fetch queue status:', error)
      }
    }
    
    fetchQueueStatus()
    const interval = setInterval(fetchQueueStatus, 5000)
    
    return () => clearInterval(interval)
  }, [isElectron])
  
  // Handle manual sync
  const handleFlushQueue = useCallback(async () => {
    if (!isElectron || isSyncing) return
    
    setIsSyncing(true)
    try {
      const result = await (window as any).electron.ipcRenderer.invoke('postgres-offline:flushQueue')
      if (result.success) {
        setLastSyncTime(new Date())
        // Refresh status immediately
        const statusResult = await (window as any).electron.ipcRenderer.invoke('postgres-offline:queueStatus')
        if (statusResult.success) {
          setQueueStatus(statusResult.data)
        }
      }
    } catch (error) {
      console.error('Failed to flush queue:', error)
    } finally {
      setIsSyncing(false)
    }
  }, [isElectron, isSyncing])
  
  // Export/Import for Web mode
  const handleExportQueue = useCallback(async () => {
    // Get pending operations from memory
    const operations = (window as any).__pendingOperations || []
    const exportData = {
      version: 1,
      timestamp: new Date().toISOString(),
      device: navigator.userAgent,
      operations
    }
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `offline-queue-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])
  
  const handleImportQueue = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        
        // Validate and process imported operations
        if (data.version === 1 && Array.isArray(data.operations)) {
          // In production, would send these to the server
          console.log('Imported operations:', data.operations)
          alert(`Imported ${data.operations.length} operations`)
        }
      } catch (error) {
        console.error('Failed to import queue:', error)
        alert('Failed to import queue file')
      }
    }
    input.click()
  }, [])
  
  // Calculate counts
  const pendingCount = queueStatus?.byStatus.find(s => s.status === 'pending')?.count || '0'
  const failedCount = queueStatus?.byStatus.find(s => s.status === 'failed')?.count || '0'
  const processingCount = queueStatus?.byStatus.find(s => s.status === 'processing')?.count || '0'
  const hasIssues = parseInt(failedCount) > 0 || queueStatus?.deadLetter > 0
  
  // Web mode offline banner
  if (!isElectron && showOfflineBanner) {
    return (
      <div className="fixed top-0 left-0 right-0 bg-yellow-50 border-b border-yellow-200 p-2 z-50">
        <div className="flex items-center justify-between max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-yellow-600" />
            <span className="text-sm text-yellow-800">
              You are offline. Changes will not be saved until you reconnect.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportQueue}
              className="text-xs"
            >
              <Download className="w-3 h-3 mr-1" />
              Export
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowOfflineBanner(false)}
              className="text-xs"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    )
  }
  
  // Web mode online (simple indicator)
  if (!isElectron) {
    return (
      <TooltipProvider>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant={isOnline ? "outline" : "destructive"} className="gap-1">
                {isOnline ? (
                  <>
                    <Wifi className="w-3 h-3" />
                    Online
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3" />
                    Offline
                  </>
                )}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isOnline ? 'Connected to server' : 'No connection - changes may be lost'}</p>
            </TooltipContent>
          </Tooltip>
          
          {!isOnline && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleExportQueue}
                className="h-7 px-2"
              >
                <Download className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleImportQueue}
                className="h-7 px-2"
              >
                <Upload className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>
      </TooltipProvider>
    )
  }
  
  // Electron mode (full queue status)
  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {/* Connection Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant={isOnline ? "outline" : "secondary"}
              className={`gap-1 ${hasIssues ? 'border-yellow-500' : ''}`}
            >
              {isOnline ? (
                <Wifi className="w-3 h-3 text-green-600" />
              ) : (
                <WifiOff className="w-3 h-3 text-yellow-600" />
              )}
              {isOnline ? 'Online' : 'Offline'}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              <p>{isOnline ? 'Connected to server' : 'Working offline'}</p>
              {lastSyncTime && (
                <p>Last sync: {lastSyncTime.toLocaleTimeString()}</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
        
        {/* Queue Status */}
        {parseInt(pendingCount) > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="gap-1">
                <Clock className="w-3 h-3" />
                {pendingCount} pending
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Operations waiting to sync</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        {parseInt(processingCount) > 0 && (
          <Badge variant="default" className="gap-1 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {processingCount} syncing
          </Badge>
        )}
        
        {parseInt(failedCount) > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="w-3 h-3" />
                {failedCount} failed
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Operations that failed to sync</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        {queueStatus?.deadLetter > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="w-3 h-3" />
                {queueStatus.deadLetter} dead
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Operations that exceeded retry limit</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        {/* Manual Sync Button */}
        {isOnline && parseInt(pendingCount) > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleFlushQueue}
                disabled={isSyncing}
                className="h-7 px-2"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Sync now</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}