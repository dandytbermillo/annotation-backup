# Camera Momentum (Inertial Panning) — Patch Preview (Do Not Apply)

Status: Proposal only. No app code is modified by this document.

## Goals

- Add inertial (momentum) panning to the camera after fast drags for a smoother, Figma/Miro‑style feel.
- Keep it optional and safe: behind a feature flag and easily cancellable.
- Integrate cleanly with the camera‑based edge‑pan plan in `camera-pan-unified-nodes-plan.md`.

## UX Summary

- When the user releases during a fast pan/drag, the camera continues moving and decelerates smoothly to a stop.
- Momentum cancels immediately on any new interaction: pointer down, wheel, touchstart, overlay intent/focus, or programmatic pan/zoom.
- Tunable friction and duration with sensible defaults.

## Key Constraints (math & units)

- Our canvas transform is `translate(translateX, translateY) scale(zoom)`.
- Screen deltas/velocities must be converted to world units: `vxWorld = vxScreen / zoom`, `vyWorld = vyScreen / zoom`.
- Apply world deltas to `translateX/translateY` every rAF tick.

## API Design (new hook)

File (new): `lib/hooks/use-camera-momentum.ts`

```ts
export interface MomentumConfig {
  friction?: number;           // exponential decay: 0.92–0.98 per frame, default 0.95
  minSpeed?: number;           // world px/frame at which to stop, default 0.05
  maxMs?: number;              // hard cap on duration, default 800
  enabled?: boolean;           // governed by NEXT_PUBLIC_CANVAS_MOMENTUM
}

export interface StartMomentumArgs {
  vxScreen: number;            // px/frame from last drag samples (screen units)
  vyScreen: number;
  zoom: number;                // current camera zoom to convert units
}

export interface CameraMomentum {
  startMomentum(args: StartMomentumArgs): void;
  stopMomentum(): void;        // cancel immediately
  isActive(): boolean;
}
```

Implementation notes:
- Keep refs: `rafIdRef`, `velocityRef`, `startedAtRef`, `lastAppliedRef`, `canceledRef`.
- Convert to world velocity on start: `vxW = vxScreen/zoom`, `vyW = vyScreen/zoom`.
- rAF tick:
  - `vxW *= friction; vyW *= friction;`
  - if `|vxW| < minSpeed && |vyW| < minSpeed` or `elapsed > maxMs` → stop.
  - Dispatch camera pan: `translateX += vxW; translateY += vyW`.
- Cancel on: pointerdown, wheel, touchstart, overlay enter/focus, or explicit `stopMomentum()`.
- Option: during momentum, minimize React churn by setting style transform directly on `#infinite-canvas` and committing to state at the end. Simpler path: dispatch per tick; keep it under flag to measure.

## Hook Skeleton (for reference)

```ts
import { useCallback, useEffect, useRef } from 'react'
import { useCanvas } from '@/components/canvas/canvas-context'

export function useCameraMomentum(config?: Partial<{ friction:number; minSpeed:number; maxMs:number; enabled:boolean }>) {
  const { state, dispatch } = useCanvas()
  const rafRef = useRef<number|null>(null)
  const velRef = useRef({ vx:0, vy:0 }) // world units px/frame
  const startedAtRef = useRef(0)
  const activeRef = useRef(false)
  const opts = { friction: 0.95, minSpeed: 0.05, maxMs: 800, enabled: true, ...config }

  const tick = useCallback(() => {
    if (!activeRef.current) return
    const now = performance.now()
    const elapsed = now - startedAtRef.current
    velRef.current.vx *= opts.friction
    velRef.current.vy *= opts.friction
    const stop = (Math.abs(velRef.current.vx) < opts.minSpeed && Math.abs(velRef.current.vy) < opts.minSpeed) || elapsed > opts.maxMs
    if (stop) { activeRef.current = false; rafRef.current && cancelAnimationFrame(rafRef.current); rafRef.current = null; return }
    const { translateX, translateY } = state.canvasState
    dispatch({ type:'SET_CANVAS_STATE', payload:{ translateX: translateX + velRef.current.vx, translateY: translateY + velRef.current.vy }})
    rafRef.current = requestAnimationFrame(tick)
  }, [dispatch, state.canvasState, opts.friction, opts.minSpeed, opts.maxMs])

  const startMomentum = useCallback(({ vxScreen, vyScreen, zoom }:{ vxScreen:number; vyScreen:number; zoom:number }) => {
    if (!opts.enabled) return
    velRef.current = { vx: vxScreen / Math.max(zoom, 0.001), vy: vyScreen / Math.max(zoom, 0.001) }
    startedAtRef.current = performance.now()
    activeRef.current = (Math.abs(velRef.current.vx) + Math.abs(velRef.current.vy)) > (opts.minSpeed * 2)
    if (!activeRef.current) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }, [opts.enabled, opts.minSpeed, tick])

  const stopMomentum = useCallback(() => {
    activeRef.current = false
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  return { startMomentum, stopMomentum, isActive: () => activeRef.current }
}
```

## Wiring Points (Panels/Components)

Compute pointer velocity on drag end and start momentum.

```ts
// in canvas-panel.tsx and component-panel.tsx
const momentum = useCameraMomentum({ enabled: process.env.NEXT_PUBLIC_CANVAS_MOMENTUM === '1' })
const moveSamplesRef = useRef<Array<{t:number,x:number,y:number}>>([])

// during pointer move while dragging
moveSamplesRef.current.push({ t: performance.now(), x: e.clientX, y: e.clientY })
if (moveSamplesRef.current.length > 8) moveSamplesRef.current.shift()

// on drag end
const now = performance.now()
const recent = moveSamplesRef.current.filter(s => now - s.t <= 100)
if (recent.length >= 2) {
  const first = recent[0], last = recent[recent.length-1]
  const dt = Math.max(1, last.t - first.t)
  const vxScreen = (last.x - first.x) / (dt / 16.67) // px per 60Hz frame
  const vyScreen = (last.y - first.y) / (dt / 16.67)
  momentum.startMomentum({ vxScreen, vyScreen, zoom: state.canvasState.zoom })
}
moveSamplesRef.current = []
panAccumRef.current = { dxWorld: 0, dyWorld: 0 }
```

## Cancellation Points

- On pointerdown anywhere in the canvas / overlay → `stopMomentum()`.
- On wheel/touchstart → stop.
- On overlay intent (pointer/focus enters overlay) → stop.
- On programmatic pan/zoom change (optional) → stop.

## Feature Flag

- `NEXT_PUBLIC_CANVAS_MOMENTUM=1`
- Optional tuning flags:
  - `NEXT_PUBLIC_MOMENTUM_FRICTION=0.95`
  - `NEXT_PUBLIC_MOMENTUM_MAXMS=800`

## Test Plan

- Release after a fast pan at zoom 1.0 → camera keeps moving and eases to stop within ~800ms.
- Repeat at zoom 0.5 and 2.0 → distance/time feel similar (world‑unit math correct).
- Interact during momentum → it cancels immediately.
- Edge‑pan + release → momentum continues smoothly from last velocity.

## Safety & Rollback

- Entirely behind a flag; no impact when disabled.
- No provider API changes; uses existing `SET_CANVAS_STATE` dispatch.
- Clean cancellation and unmount cleanup.

---

This is a follow‑up to `camera-pan-unified-nodes-plan.md` and should be implemented only after camera‑based edge‑pan is in place.

