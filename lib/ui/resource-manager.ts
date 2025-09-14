"use client"

type Task = { cb: () => void; timeoutMs?: number; enqueuedAt: number }

function ric(cb: IdleRequestCallback, opts?: IdleRequestOptions) {
  if (typeof (window as any).requestIdleCallback === 'function') {
    return (window as any).requestIdleCallback(cb, opts)
  }
  // Fallback to setTimeout ~50ms
  const id = setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as any), opts?.timeout ?? 50)
  return id as unknown as number
}

function cancelRic(id: number) {
  if (typeof (window as any).cancelIdleCallback === 'function') {
    (window as any).cancelIdleCallback(id)
  } else {
    clearTimeout(id as any)
  }
}

export class UIResourceManager {
  private queue: Task[] = []
  private idleId: number | null = null

  enqueueLowPriority(cb: () => void, timeoutMs: number = 150) {
    this.queue.push({ cb, timeoutMs, enqueuedAt: Date.now() })
    this.schedule()
  }

  private schedule() {
    if (this.idleId != null) return
    this.idleId = ric(() => {
      this.idleId = null
      const start = performance.now()
      // Drain a few tasks per idle period (time-sliced)
      let count = 0
      while (this.queue.length && count < 6) {
        const task = this.queue.shift()!
        try { task.cb() } catch {}
        count++
        if (performance.now() - start > 8) break // keep it brief
      }
      if (this.queue.length) this.schedule()
    }, { timeout: 200 })
  }
}

let singleton: UIResourceManager | null = null
export function getUIResourceManager() {
  if (!singleton) singleton = new UIResourceManager()
  return singleton
}

