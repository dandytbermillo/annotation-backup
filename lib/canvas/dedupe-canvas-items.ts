'use client'

import { ensurePanelKey, parsePanelKey } from '@/lib/canvas/composite-id'
import type { CanvasItem } from '@/types/canvas-items'

export type CanvasDedupeWarningCode =
  | 'missing_note_id'
  | 'missing_panel_id'
  | 'invalid_store_key'

export interface CanvasDedupeWarning {
  code: CanvasDedupeWarningCode
  panelId?: string
  noteId?: string
  storeKey?: string
  message: string
}

export interface CanvasDedupeResult {
  items: CanvasItem[]
  warnings: CanvasDedupeWarning[]
  removedCount: number
}

export interface CanvasDedupeOptions {
  /**
   * Optional note identifier used when a panel item does not provide one.
   */
  fallbackNoteId?: string
}

const UNKNOWN_KEY_PREFIX = 'canvas-dedupe:missing'

export function dedupeCanvasItems(
  items: CanvasItem[],
  options: CanvasDedupeOptions = {},
): CanvasDedupeResult {
  const seenKeys = new Set<string>()
  const dedupedReversed: CanvasItem[] = []
  const warningMap = new Map<string, CanvasDedupeWarning>()
  let removedCount = 0

  const registerWarning = (warning: CanvasDedupeWarning) => {
    const key = `${warning.code}:${warning.panelId ?? ''}:${warning.noteId ?? ''}:${warning.storeKey ?? ''}`
    if (!warningMap.has(key)) {
      warningMap.set(key, warning)
    }
  }

  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.itemType !== 'panel') {
      dedupedReversed.push(item)
      continue
    }

    const panelId = item.panelId ?? 'unknown'
    const fallbackNoteId = options.fallbackNoteId
    const noteIdForKey = item.noteId ?? fallbackNoteId
    const fallbackKeyBase = `${UNKNOWN_KEY_PREFIX}-${panelId}-${noteIdForKey ?? 'global'}`

    if (!item.panelId) {
      registerWarning({
        code: 'missing_panel_id',
        panelId,
        noteId: item.noteId ?? options.fallbackNoteId,
        storeKey: item.storeKey,
        message: `Panel is missing a panelId; dedupe used '${panelId}'.`,
      })
    }

    if (!item.noteId && !fallbackNoteId) {
      registerWarning({
        code: 'missing_note_id',
        panelId,
        noteId: undefined,
        storeKey: item.storeKey,
        message: `Panel '${panelId}' does not have a noteId. Dedupe generated a temporary key.`,
      })
    }

    let dedupeKey = item.storeKey ?? null
    if (dedupeKey) {
      const parsed = parsePanelKey(dedupeKey)
      if (parsed.noteId && !item.noteId) {
        item.noteId = parsed.noteId
      }
      if (!parsed.noteId || !parsed.panelId) {
        registerWarning({
          code: 'invalid_store_key',
          panelId,
          noteId: parsed.noteId ?? noteIdForKey,
          storeKey: dedupeKey,
          message: `Panel '${panelId}' has malformed storeKey '${dedupeKey}'.`,
        })
        dedupeKey = noteIdForKey ? ensurePanelKey(noteIdForKey, panelId) : fallbackKeyBase
      }
    } else if (noteIdForKey) {
      dedupeKey = ensurePanelKey(noteIdForKey, panelId)
    } else {
      dedupeKey = fallbackKeyBase
    }

    if (!item.storeKey && noteIdForKey) {
      item.storeKey = dedupeKey
    }

    if (seenKeys.has(dedupeKey)) {
      removedCount += 1
      continue
    }
    seenKeys.add(dedupeKey)
    dedupedReversed.push(item)
  }

  return {
    items: dedupedReversed.reverse(),
    warnings: Array.from(warningMap.values()),
    removedCount,
  }
}
