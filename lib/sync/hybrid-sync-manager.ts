import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'

export interface SyncStrategy {
  type: 'webrtc' | 'websocket' | 'local'
  priority: number
  isAvailable: boolean
  latency?: number
  provider?: any
}

export class MetricsCollector {
  private metrics: Map<string, any> = new Map()
  
  recordStrategySwitch(strategy: string, latency: number): void {
    this.metrics.set('lastStrategySwitch', {
      strategy,
      latency,
      timestamp: Date.now()
    })
  }
  
  recordOperation(operation: string): void {
    const key = `operations.${operation}`
    const current = this.metrics.get(key) || 0
    this.metrics.set(key, current + 1)
  }
  
  getMetrics(): Map<string, any> {
    return new Map(this.metrics)
  }
}

export class HybridSyncManager {
  private strategies: Map<string, SyncStrategy> = new Map()
  private activeStrategy: string | null = null
  private metricsCollector: MetricsCollector
  private latency: number = 0
  
  constructor(private doc: Y.Doc, private roomId: string) {
    this.metricsCollector = new MetricsCollector()
    this.initializeStrategies()
  }
  
  private async initializeStrategies(): Promise<void> {
    // WebRTC Strategy (Priority 1)
    if (this.canUseWebRTC()) {
      const webrtcStrategy: SyncStrategy = {
        type: 'webrtc',
        priority: 1,
        isAvailable: true,
        provider: await this.createWebRTCProvider()
      }
      this.strategies.set('webrtc', webrtcStrategy)
    }
    
    // WebSocket Strategy (Priority 2)
    const websocketStrategy: SyncStrategy = {
      type: 'websocket',
      priority: 2,
      isAvailable: true,
      provider: await this.createWebSocketProvider()
    }
    this.strategies.set('websocket', websocketStrategy)
    
    // Local Strategy (Priority 3)
    const localStrategy: SyncStrategy = {
      type: 'local',
      priority: 3,
      isAvailable: true,
      provider: null
    }
    this.strategies.set('local', localStrategy)
    
    await this.selectOptimalStrategy()
    this.startQualityMonitoring()
  }
  
  private async createWebRTCProvider(): Promise<any> {
    if (typeof window !== 'undefined') {
      try {
        const { WebrtcProvider } = await import('y-webrtc')
        return new WebrtcProvider(this.roomId, this.doc, {
          signaling: ['wss://signaling.example.com'],
          password: null,
          awareness: new Awareness(this.doc),
          maxConns: 20,
          filterBcConns: true,
          peerOpts: {}
        })
      } catch (error) {
        console.warn('WebRTC provider not available:', error)
        return null
      }
    }
    return null
  }
  
  private async createWebSocketProvider(): Promise<any> {
    try {
      const { WebsocketProvider } = await import('y-websocket')
      return new WebsocketProvider(
        'wss://sync.example.com',
        this.roomId,
        this.doc,
        {
          connect: true,
          awareness: new Awareness(this.doc),
          params: {},
          resyncInterval: 5000,
          maxBackoffTime: 2500,
          subdocs: true
        }
      )
    } catch (error) {
      console.warn('WebSocket provider not available:', error)
      return null
    }
  }
  
  private async selectOptimalStrategy(): Promise<void> {
    const sortedStrategies = Array.from(this.strategies.entries())
      .sort(([, a], [, b]) => a.priority - b.priority)
    
    for (const [name, strategy] of sortedStrategies) {
      if (strategy.isAvailable && strategy.provider) {
        try {
          const latency = await this.testStrategyLatency(strategy)
          strategy.latency = latency
          this.latency = latency
          
          if (latency < 100) {
            this.activeStrategy = name
            this.metricsCollector.recordStrategySwitch(name, latency)
            break
          }
        } catch (error) {
          strategy.isAvailable = false
        }
      }
    }
    
    // Fallback to local if no strategy works
    if (!this.activeStrategy) {
      this.activeStrategy = 'local'
      this.latency = 0
      this.metricsCollector.recordStrategySwitch('local', 0)
    }
  }
  
  private startQualityMonitoring(): void {
    setInterval(async () => {
      if (this.activeStrategy && this.activeStrategy !== 'local') {
        const strategy = this.strategies.get(this.activeStrategy)
        if (strategy && strategy.provider) {
          const latency = await this.testStrategyLatency(strategy)
          this.latency = latency
          
          if (latency > 500) {
            await this.selectOptimalStrategy()
          }
        }
      }
    }, 30000)
  }
  
  private canUseWebRTC(): boolean {
    return typeof RTCPeerConnection !== 'undefined' && 
           typeof navigator !== 'undefined' && 
           navigator.onLine
  }
  
  private async testStrategyLatency(strategy: SyncStrategy): Promise<number> {
    const start = Date.now()
    
    // Simple latency test - in production, implement actual ping/pong
    if (strategy.type === 'webrtc' || strategy.type === 'websocket') {
      // Simulate network check
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    return Date.now() - start
  }
  
  public async switchStrategy(strategyName: string): Promise<void> {
    if (strategyName === 'auto') {
      await this.selectOptimalStrategy()
      return
    }
    
    const strategy = this.strategies.get(strategyName)
    if (strategy && strategy.isAvailable) {
      this.activeStrategy = strategyName
      this.latency = strategy.latency || 0
      this.metricsCollector.recordStrategySwitch(strategyName, this.latency)
    }
  }
  
  public getLatency(): number {
    return this.latency
  }
  
  public disconnect(): void {
    this.strategies.forEach(strategy => {
      if (strategy.provider && strategy.provider.destroy) {
        strategy.provider.destroy()
      }
    })
  }
} 