import * as Y from 'yjs'
import type { EnhancedCollaborationProvider } from '../enhanced-yjs-provider'

export interface DetailedMetrics {
  syncLatency: number
  memoryUsage: {
    panels: number
    annotations: number
    total: number
  }
  activePanels: number
  networkBandwidth: {
    incoming: number
    outgoing: number
  }
  lastGC: Date
  annotations: {
    total: number
    active: number
    merged: number
    orphaned: number
  }
  sync: {
    strategy: string
    latency: number
    lastSync: Date
    pendingUpdates: number
  }
  memory: {
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
  }
  operations: {
    reads: number
    writes: number
    syncs: number
    conflicts: number
  }
}

export class PerformanceMonitor {
  private metrics: DetailedMetrics
  private metricsHistory: DetailedMetrics[] = []
  private metricsInterval: NodeJS.Timeout | null = null
  private operationCounts = {
    'branch-created': 0,
    'branch-deleted': 0,
    'branch-updated': 0,
    'panel-loaded': 0,
    'panel-unloaded': 0
  }
  
  constructor(private provider: EnhancedCollaborationProvider) {
    this.metrics = this.initializeMetrics()
    this.startMonitoring()
  }
  
  private initializeMetrics(): DetailedMetrics {
    return {
      syncLatency: 0,
      memoryUsage: {
        panels: 0,
        annotations: 0,
        total: 0
      },
      activePanels: 0,
      networkBandwidth: {
        incoming: 0,
        outgoing: 0
      },
      lastGC: new Date(),
      annotations: {
        total: 0,
        active: 0,
        merged: 0,
        orphaned: 0
      },
      sync: {
        strategy: 'unknown',
        latency: 0,
        lastSync: new Date(),
        pendingUpdates: 0
      },
      memory: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0
      },
      operations: {
        reads: 0,
        writes: 0,
        syncs: 0,
        conflicts: 0
      }
    }
  }
  
  private startMonitoring(): void {
    // Collect metrics every second
    this.metricsInterval = setInterval(() => {
      this.collectMetrics()
      this.analyzePerformance()
      
      // Store history (keep last 60 seconds)
      this.metricsHistory.push({ ...this.metrics })
      if (this.metricsHistory.length > 60) {
        this.metricsHistory.shift()
      }
    }, 1000)
    
    // Setup performance observers
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      this.setupWebMetrics()
    }
  }
  
  private collectMetrics(): void {
    const doc = this.provider.getMainDoc()
    const branches = doc.getMap('branches')
    const panels = doc.getMap('metadata').get('panels') as Y.Map<any>
    
    // Annotation metrics
    let total = 0, active = 0, merged = 0, orphaned = 0
    branches.forEach(branch => {
      total++
      const visibility = branch.get('visibility')
      const mergedInto = branch.get('mergedInto')
      
      if (visibility === 'merged' || mergedInto) merged++
      else if (visibility === 'orphaned') orphaned++
      else active++
    })
    
    this.metrics.annotations = { total, active, merged, orphaned }
    
    // Memory metrics
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage()
      this.metrics.memory = {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers || 0
      }
    } else if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as any).memory
      this.metrics.memory = {
        heapUsed: memory.usedJSHeapSize,
        heapTotal: memory.totalJSHeapSize,
        external: 0,
        arrayBuffers: 0
      }
    }
    
    // Calculate total memory usage
    this.metrics.memoryUsage.total = this.metrics.memory.heapUsed
    this.metrics.memoryUsage.panels = panels.size * 1024 * 100
    this.metrics.memoryUsage.annotations = branches.size * 1024 * 10
    
    // Active panels from provider
    const providerMetrics = this.provider.getMetrics()
    this.metrics.activePanels = providerMetrics.activePanels
    this.metrics.syncLatency = providerMetrics.syncLatency
    
    // Update operations
    this.metrics.operations.writes = this.operationCounts['branch-created'] + 
                                     this.operationCounts['branch-updated']
    this.metrics.operations.reads = this.operationCounts['panel-loaded']
  }
  
  private analyzePerformance(): void {
    const issues: string[] = []
    
    if (this.metrics.syncLatency > 500) {
      issues.push('High sync latency detected')
    }
    
    if (this.metrics.memory.heapUsed > 500 * 1024 * 1024) {
      issues.push('High memory usage')
    }
    
    if (this.metrics.annotations.orphaned > 100) {
      issues.push('Many orphaned annotations')
    }
    
    if (issues.length > 0) {
      this.emitPerformanceWarning(issues)
    }
  }
  
  private setupWebMetrics(): void {
    // Navigation timing
    const navObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      entries.forEach(entry => {
        if (entry.entryType === 'navigation') {
          console.log('Navigation timing:', entry)
        }
      })
    })
    
    try {
      navObserver.observe({ entryTypes: ['navigation'] })
    } catch (error) {
      console.warn('Failed to observe navigation timing:', error)
    }
    
    // Resource timing for sync operations
    const resourceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      entries.forEach(entry => {
        if (entry.name.includes('sync') || entry.name.includes('yjs')) {
          this.metrics.syncLatency = entry.duration
        }
      })
    })
    
    try {
      resourceObserver.observe({ entryTypes: ['resource'] })
    } catch (error) {
      console.warn('Failed to observe resource timing:', error)
    }
  }
  
  getMetrics(): DetailedMetrics {
    return { ...this.metrics }
  }
  
  getMetricsHistory(): DetailedMetrics[] {
    return [...this.metricsHistory]
  }
  
  recordOperation(operation: string): void {
    if (operation in this.operationCounts) {
      (this.operationCounts as any)[operation]++
    }
    
    // Update sync metrics
    if (operation.includes('sync')) {
      this.metrics.operations.syncs++
      this.metrics.sync.lastSync = new Date()
    }
    
    // Update conflict metrics
    if (operation.includes('conflict') || operation.includes('merge')) {
      this.metrics.operations.conflicts++
    }
  }
  
  private emitPerformanceWarning(issues: string[]): void {
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('performance-warning', {
        detail: { issues, metrics: this.metrics }
      })
      window.dispatchEvent(event)
    }
  }
  
  destroy(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval)
    }
  }
} 