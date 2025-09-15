"use client"

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { IsolationConfig, IsolationLevel, IsolationStateEntry, Priority, RegisteredComponent } from './types'

const DEFAULT_CONFIG: IsolationConfig = {
  enabled: false,
  evaluationIntervalMs: 400,
  minFPS: 30,
  consecutiveBadWindows: 4,
  autoRestore: true,
  restoreDelayMs: 10000, // Increased to 10 seconds for easier testing
  maxIsolated: 2,
  exposeDebug: false,
}

type IsolationMap = Map<string, IsolationStateEntry>

interface IsolationContextValue {
  config: IsolationConfig
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  register: (id: string, el: HTMLElement, priority?: Priority, type?: string) => void
  unregister: (id: string) => void
  getLevel: (id: string) => IsolationLevel
  requestRestore: (id: string) => void
  subscribe: (cb: () => void) => () => void
  getIsolatedSnapshot: () => string[]
  // Snapshot for a monotonically increasing version to force reactivity in external subscribers
  getVersionSnapshot: () => number
  // Optional richer snapshot for UI filtering by reason
  getIsolatedDetailsSnapshot: () => Array<{ id: string; entry: IsolationStateEntry }>
}

const IsolationContext = createContext<IsolationContextValue | null>(null)

export function IsolationProvider({ children, config }: { children: React.ReactNode; config?: Partial<IsolationConfig> }) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }

  const [enabled, setEnabled] = useState<boolean>(cfg.enabled)
  const [isolationState, setIsolationState] = useState<IsolationMap>(new Map())
  // Version counter to force reactivity for any external consumers
  const [version, setVersion] = useState<number>(0)
  const componentsRef = useRef<Map<string, RegisteredComponent>>(new Map())
  const isolationRef = useRef<IsolationMap>(new Map())
  const subscribersRef = useRef<Set<() => void>>(new Set())
  const isolatedIdsRef = useRef<string[]>([])
  const isolatedDetailsRef = useRef<Array<{ id: string; entry: IsolationStateEntry }>>([])
  const lowFPSWindowsRef = useRef<number>(0)
  const fpsRef = useRef<number>(60)
  const rafIdRef = useRef<number | null>(null)
  const lastRAFRef = useRef<number>(performance.now())
  const versionRef = useRef<number>(0)

  // Centralized state emission to ensure consistent updates + version bump
  const emit = useCallback(() => {
    setIsolationState(new Map(isolationRef.current))
    isolatedIdsRef.current = Array.from(isolationRef.current.keys())
    isolatedDetailsRef.current = Array.from(isolationRef.current.entries()).map(([id, entry]) => ({ id, entry }))
    versionRef.current += 1
    setVersion(v => v + 1)
    subscribersRef.current.forEach(fn => { try { fn() } catch {} })
  }, [])

  // Simple FPS tracker with EWMA smoothing (gated by `enabled`)
  useEffect(() => {
    if (!enabled) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      return
    }
    const alpha = 0.2
    const tick = (now: number) => {
      const delta = now - lastRAFRef.current
      if (delta > 0) {
        const inst = 1000 / delta
        fpsRef.current = alpha * inst + (1 - alpha) * fpsRef.current
      }
      lastRAFRef.current = now
      rafIdRef.current = requestAnimationFrame(tick)
    }
    rafIdRef.current = requestAnimationFrame(tick)
    return () => { if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current) }
  }, [enabled])

  // Evaluate periodically when enabled
  useEffect(() => {
    if (!enabled) return
    const iv = setInterval(() => {
      const fps = fpsRef.current
      if (fps < cfg.minFPS) lowFPSWindowsRef.current++
      else lowFPSWindowsRef.current = 0

      // Only act when enough consecutive bad windows
      if (lowFPSWindowsRef.current >= cfg.consecutiveBadWindows) {
        lowFPSWindowsRef.current = 0
        attemptIsolation()
      }

      // Auto-restore after delay
      if (cfg.autoRestore) {
        const now = performance.now()
        let hasChanges = false
        for (const [id, ent] of isolationRef.current) {
          if (now - ent.isolatedAt > cfg.restoreDelayMs) {
            isolationRef.current.delete(id)
            hasChanges = true
          }
        }
        if (hasChanges) emit()
      }
    }, cfg.evaluationIntervalMs)
    return () => clearInterval(iv)
  }, [enabled, cfg.evaluationIntervalMs, cfg.minFPS, cfg.consecutiveBadWindows, cfg.autoRestore, cfg.restoreDelayMs])

  const attemptIsolation = () => {
    // If we're already at capacity, skip
    if (isolationRef.current.size >= cfg.maxIsolated) return
    // Choose the heaviest component by DOM node count (simple heuristic)
    let best: { id: string; score: number } | null = null
    for (const [id, reg] of componentsRef.current) {
      if (isolationRef.current.has(id)) continue
      // Priority guard: never isolate critical items
      if (reg.priority === 'critical') continue
      const nodes = reg.el ? reg.el.querySelectorAll('*').length + 1 : 0
      const score = nodes * (reg.priority === 'high' ? 0.75 : reg.priority === 'normal' ? 1 : 1.25)
      if (!best || score > best.score) best = { id, score }
    }
    if (best) {
      const entry: IsolationStateEntry = { level: 'soft', isolatedAt: performance.now(), reason: 'auto', fpsAtIsolation: fpsRef.current }
      isolationRef.current.set(best.id, entry)
      emit()
      return true
    }
    return false
  }

  // Expose debug API only in development or when explicitly enabled
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || cfg.exposeDebug) {
      (window as any).__isolationDebug = {
        enable: (v: boolean) => setEnabled(v),
        // Attempt isolation only if the system is currently slow
        attemptIfSlow: () => {
          if (fpsRef.current < cfg.minFPS) {
            return attemptIsolation()
          }
          return false
        },
        // For testing: forcibly attempt isolation without FPS gating
        attempt: () => attemptIsolation(),
        // Expose current FPS snapshot for diagnostics
        getFps: () => fpsRef.current,
        isolate: (id: string) => {
          const entry: IsolationStateEntry = { level: 'soft', isolatedAt: performance.now(), reason: 'manual', fpsAtIsolation: fpsRef.current }
          isolationRef.current.set(id, entry)
          emit()
        },
        restore: (id: string) => {
          isolationRef.current.delete(id)
          emit()
        },
        list: () => Array.from(isolationRef.current.keys()),
      }
      return () => { delete (window as any).__isolationDebug }
    }
  }, [cfg.exposeDebug, emit])

  const api = useMemo<IsolationContextValue>(() => ({
    config: cfg,
    enabled,
    setEnabled: (v: boolean) => setEnabled(v),
    register: (id, el, priority: Priority = 'normal', type?: string) => {
      componentsRef.current.set(id, { id, el, priority, type: type || 'component' })
    },
    unregister: (id) => { componentsRef.current.delete(id) },
    getLevel: (id) => isolationState.get(id)?.level || 'none',
    requestRestore: (id) => { 
      isolationRef.current.delete(id)
      emit()
    },
    subscribe: (cb: () => void) => { subscribersRef.current.add(cb); return () => subscribersRef.current.delete(cb) },
    getIsolatedSnapshot: () => isolatedIdsRef.current,
    getVersionSnapshot: () => versionRef.current,
    getIsolatedDetailsSnapshot: () => isolatedDetailsRef.current,
  }), [cfg, isolationState, enabled, emit])

  return (
    <IsolationContext.Provider value={api}>
      {children}
    </IsolationContext.Provider>
  )
}

export function useIsolation(id: string) {
  const ctx = useContext(IsolationContext)
  const level = ctx?.getLevel(id) || 'none'
  const isIsolated = level !== 'none'
  const placeholder = (
    <div className="p-4 bg-gray-900 text-yellow-300 border border-yellow-500 rounded">
      <div className="font-semibold mb-1">Component Isolated</div>
      <div className="text-xs text-yellow-200 mb-2">Temporarily suspended to keep the canvas responsive.</div>
      <button
        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
        onClick={() => ctx?.requestRestore(id)}
      >
        Restore
      </button>
    </div>
  )
  return { isIsolated, level, placeholder, setEnabled: ctx?.setEnabled }
}

export function useRegisterWithIsolation(id: string, ref: React.RefObject<HTMLElement>, priority: Priority = 'normal', type?: string) {
  const ctx = useContext(IsolationContext)
  useEffect(() => {
    const el = ref.current
    if (el && ctx) {
      ctx.register(id, el, priority, type)
      return () => ctx.unregister(id)
    }
  }, [id, ref, ctx, priority, type])
}

export function useIsolationSystem() {
  const ctx = useContext(IsolationContext)
  return {
    enabled: ctx?.enabled ?? false,
    setEnabled: ctx?.setEnabled ?? (() => {}),
    config: ctx?.config ?? DEFAULT_CONFIG,
  }
}

// Replace polling with subscription for isolated ID list
export function useIsolatedIds(): string[] {
  const ctx = useContext(IsolationContext)
  if (!ctx) return []
  const getServerSnapshot = () => []
  return useSyncExternalStore(ctx.subscribe, ctx.getIsolatedSnapshot, getServerSnapshot)
}

// Optional: subscribe to the provider's monotonically increasing version for coarse-grained reactivity
export function useIsolationVersion(): number {
  const ctx = useContext(IsolationContext)
  if (!ctx) return 0
  const getServerSnapshot = () => 0
  return useSyncExternalStore(ctx.subscribe, ctx.getVersionSnapshot, getServerSnapshot)
}

export function useIsolatedDetails(): Array<{ id: string; entry: IsolationStateEntry }> {
  const ctx = useContext(IsolationContext)
  if (!ctx) return []
  const getServerSnapshot = () => [] as Array<{ id: string; entry: IsolationStateEntry }>
  return useSyncExternalStore(ctx.subscribe, ctx.getIsolatedDetailsSnapshot, getServerSnapshot)
}
