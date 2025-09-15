"use client"

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { IsolationConfig, IsolationLevel, IsolationStateEntry, Priority, RegisteredComponent } from './types'

const DEFAULT_CONFIG: IsolationConfig = {
  enabled: false,
  evaluationIntervalMs: 400,
  minFPS: 30,
  consecutiveBadWindows: 4,
  autoRestore: true,
  restoreDelayMs: 10000, // Increased to 10 seconds for easier testing
  maxIsolated: 2,
}

type IsolationMap = Map<string, IsolationStateEntry>

interface IsolationContextValue {
  config: IsolationConfig
  setEnabled: (enabled: boolean) => void
  register: (id: string, el: HTMLElement, priority?: Priority, type?: string) => void
  unregister: (id: string) => void
  getLevel: (id: string) => IsolationLevel
  requestRestore: (id: string) => void
}

const IsolationContext = createContext<IsolationContextValue | null>(null)

export function IsolationProvider({ children, config }: { children: React.ReactNode; config?: Partial<IsolationConfig> }) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }

  const [enabled, setEnabled] = useState<boolean>(cfg.enabled)
  const [isolationState, setIsolationState] = useState<IsolationMap>(new Map())
  const componentsRef = useRef<Map<string, RegisteredComponent>>(new Map())
  const isolationRef = useRef<IsolationMap>(new Map())
  const lowFPSWindowsRef = useRef<number>(0)
  const fpsRef = useRef<number>(60)
  const rafIdRef = useRef<number | null>(null)
  const lastRAFRef = useRef<number>(performance.now())

  // Simple FPS tracker with EWMA smoothing
  useEffect(() => {
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
  }, [])

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
        if (hasChanges) {
          setIsolationState(new Map(isolationRef.current))
        }
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
      const entry = { level: 'soft' as IsolationLevel, isolatedAt: performance.now() }
      isolationRef.current.set(best.id, entry)
      setIsolationState(new Map(isolationRef.current))
    }
  }

  // Expose simple debug API for verification
  useEffect(() => {
    ;(window as any).__isolationDebug = {
      enable: (v: boolean) => setEnabled(v),
      isolate: (id: string) => {
        const entry = { level: 'soft' as IsolationLevel, isolatedAt: performance.now() }
        isolationRef.current.set(id, entry)
        setIsolationState(new Map(isolationRef.current))
        console.log('[Isolation] Component isolated:', id)
      },
      restore: (id: string) => {
        isolationRef.current.delete(id)
        setIsolationState(new Map(isolationRef.current))
        console.log('[Isolation] Component restored:', id)
      },
      list: () => Array.from(isolationRef.current.keys()),
    }
    return () => { delete (window as any).__isolationDebug }
  }, [])

  const api = useMemo<IsolationContextValue>(() => ({
    config: cfg,
    setEnabled: (v: boolean) => setEnabled(v),
    register: (id, el, priority: Priority = 'normal', type?: string) => {
      componentsRef.current.set(id, { id, el, priority, type: type || 'component' })
    },
    unregister: (id) => { componentsRef.current.delete(id) },
    getLevel: (id) => isolationState.get(id)?.level || 'none',
    requestRestore: (id) => { 
      isolationRef.current.delete(id)
      setIsolationState(new Map(isolationRef.current))
      console.log('[Isolation] Component restore requested:', id)
    },
  }), [cfg, isolationState])

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
