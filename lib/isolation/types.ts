export type IsolationLevel = 'none' | 'soft' | 'hard'

export type Priority = 'critical' | 'high' | 'normal' | 'low'

export interface IsolationConfig {
  enabled: boolean
  evaluationIntervalMs: number
  minFPS: number
  consecutiveBadWindows: number
  autoRestore: boolean
  restoreDelayMs: number
  maxIsolated: number
}

export interface RegisteredComponent {
  id: string
  type: string
  priority: Priority
  el: HTMLElement
  lastMetrics?: { domNodes: number }
}

export interface IsolationStateEntry {
  level: IsolationLevel
  isolatedAt: number
}

