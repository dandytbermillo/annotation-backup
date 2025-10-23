'use client'

import { dedupeCanvasItems } from '@/lib/canvas/dedupe-canvas-items'
import { debugLog } from '@/lib/utils/debug-logger'
import type { CanvasItem } from '@/types/canvas-items'

const STORAGE_PREFIX = 'annotation-canvas-state'
const MIGRATION_COMPLETE_KEY = 'canvas-migration:dedupe-v1'
const IDLE_SLICE_BUDGET_MS = 50

type IdleDeadline = {
  didTimeout?: boolean
  timeRemaining?: () => number
}

const getIdleCallback = () => {
  if (typeof window === 'undefined') return null
  return (window as Window & { requestIdleCallback?: (cb: (deadline: IdleDeadline) => void) => number }).requestIdleCallback ?? null
}

const scheduleIdle = (fn: (deadline: IdleDeadline) => void) => {
  const ric = getIdleCallback()
  if (ric) {
    ric(fn)
  } else {
    setTimeout(() => fn({ timeRemaining: () => 0, didTimeout: true }), 16)
  }
}

const shouldSkipMigration = () =>
  typeof window !== 'undefined' &&
  (window as unknown as { DISABLE_CANVAS_MIGRATION?: boolean }).DISABLE_CANVAS_MIGRATION === true

const isMigrationComplete = () =>
  typeof window !== 'undefined' && window.localStorage.getItem(MIGRATION_COMPLETE_KEY) === 'complete'

const markMigrationComplete = () => {
  try {
    window.localStorage.setItem(MIGRATION_COMPLETE_KEY, 'complete')
  } catch {
    // Ignore storage quota issues; migration will retry next load.
  }
}

const collectSnapshotKeys = (): string[] => {
  if (typeof window === 'undefined' || !window.localStorage) return []
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index)
    if (key && key.startsWith(`${STORAGE_PREFIX}:`)) {
      keys.push(key)
    }
  }
  return keys
}

const parseSnapshot = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, any>
  } catch {
    return null
  }
}

const persistSnapshot = (key: string, snapshot: Record<string, any>) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(snapshot))
  } catch (error) {
    console.warn('[CanvasMigration] Failed to persist deduped snapshot', { key, error })
  }
}

const dedupeSnapshotItems = (key: string, snapshot: Record<string, any>) => {
  const panelsBlock = snapshot?.panels
  const items: CanvasItem[] | undefined = Array.isArray(panelsBlock?.items)
    ? (panelsBlock.items as CanvasItem[])
    : Array.isArray(snapshot?.items)
      ? (snapshot.items as CanvasItem[])
      : undefined

  if (!items || items.length === 0) {
    return { mutated: false, removed: 0, warnings: 0 }
  }

  const noteIdFromKey = key.startsWith(`${STORAGE_PREFIX}:`)
    ? key.substring(`${STORAGE_PREFIX}:`.length)
    : undefined

  const result = dedupeCanvasItems(items, { fallbackNoteId: noteIdFromKey })

  if (result.removedCount === 0 && result.warnings.length === 0) {
    return { mutated: false, removed: 0, warnings: 0 }
  }

  if (Array.isArray(panelsBlock?.items)) {
    snapshot.panels.items = result.items
  } else {
    snapshot.items = result.items
  }

  persistSnapshot(key, snapshot)

  debugLog({
    component: 'CanvasMigration',
    action: 'snapshot_items_migrated',
    metadata: {
      key,
      removedCount: result.removedCount,
      warnings: result.warnings.map(warning => warning.code),
    },
  }).catch(() => {
    // Ignore logging failures during idle work.
  })

  return {
    mutated: true,
    removed: result.removedCount,
    warnings: result.warnings.length,
  }
}

export function scheduleCanvasSnapshotDedupeMigration(): void {
  if (typeof window === 'undefined') return
  if (!window.localStorage) return
  if (shouldSkipMigration()) return
  if (isMigrationComplete()) return

  const keys = collectSnapshotKeys()
  if (keys.length === 0) {
    markMigrationComplete()
    return
  }

  let index = 0
  const startedAt = performance.now()
  let totalRemoved = 0
  let totalWarnings = 0

  const processChunk = (deadline: IdleDeadline) => {
    const sliceStart = performance.now()
    while (index < keys.length) {
      const key = keys[index]
      const raw = window.localStorage.getItem(key)
      index += 1

      if (!raw) {
        continue
      }

      const snapshot = parseSnapshot(raw)
      if (!snapshot) {
        continue
      }

      const { mutated, removed, warnings } = dedupeSnapshotItems(key, snapshot)
      if (mutated) {
        totalRemoved += removed
        totalWarnings += warnings
      }

      const timeRemaining =
        typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : IDLE_SLICE_BUDGET_MS

      if (timeRemaining <= 0 || performance.now() - sliceStart > IDLE_SLICE_BUDGET_MS) {
        break
      }
    }

    if (index < keys.length) {
      scheduleIdle(processChunk)
      return
    }

    const durationMs = Math.round(performance.now() - startedAt)

    debugLog({
      component: 'CanvasMigration',
      action: 'snapshot_dedupe_complete',
      metadata: {
        totalKeys: keys.length,
        totalRemoved,
        totalWarnings,
        durationMs,
      },
    }).catch(() => {
      // Ignore logging failures during idle work.
    })

    markMigrationComplete()
  }

  scheduleIdle(processChunk)
}
