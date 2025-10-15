/**
 * TipTap Extension: Annotation Type Updater
 *
 * Provides a command to update annotation mark types efficiently.
 * Uses indexed lookups for O(1) performance instead of O(n) document traversal.
 *
 * @module lib/extensions/annotation-updater
 */

// @ts-nocheck
import { Extension } from '@tiptap/core'
import type { AnnotationType } from '@/lib/models/annotation'

// Index structure for fast annotation lookups
interface AnnotationIndex {
  [branchId: string]: Array<{ from: number; to: number; markType: any }>
}

/**
 * Normalize branchId to handle both "UUID" and "branch-UUID" formats
 */
function normalizeBranchId(id: string | null | undefined): string {
  if (!id) return ''
  // Strip "branch-" prefix if present
  return id.startsWith('branch-') ? id.slice(7) : id
}

export const AnnotationUpdater = Extension.create({
  name: 'annotationUpdater',

  addCommands() {
    return {
      /**
       * Update the type of an annotation mark
       *
       * @param branchId - The branch ID (handles both "UUID" and "branch-UUID" formats)
       * @param newType - The new annotation type
       * @returns true if annotation was found and updated, false otherwise
       */
      updateAnnotationType: (branchId: string, newType: AnnotationType) =>
        ({ tr, state, dispatch }) => {
          console.log('[AnnotationUpdater] Command called:', { branchId, newType })

          if (!branchId || !newType) {
            console.warn('[AnnotationUpdater] Invalid parameters:', { branchId, newType })
            return false
          }

          const normalizedTargetId = normalizeBranchId(branchId)
          if (!normalizedTargetId) {
            console.warn('[AnnotationUpdater] Could not normalize branchId:', branchId)
            return false
          }

          console.log('[AnnotationUpdater] Normalized target:', normalizedTargetId)

          let updated = false
          const updatePositions: Array<{ from: number; to: number; mark: any }> = []
          const allAnnotations: any[] = []

          // Build index of annotation positions
          state.doc.descendants((node, pos) => {
            if (updated) return false // Stop if we already found and updated the annotation
            if (!node.isText) return // Skip non-text nodes but continue traversal

            node.marks.forEach((mark) => {
              if (mark.type.name === 'annotation') {
                const markBranchId = mark.attrs.branchId || mark.attrs['data-branch']
                allAnnotations.push({ pos, markBranchId, type: mark.attrs.type })

                const normalizedMarkId = normalizeBranchId(markBranchId)

                console.log('[AnnotationUpdater] Comparing:', { markBranchId, normalizedMarkId, normalizedTargetId, match: normalizedMarkId === normalizedTargetId })

                // Match using normalized IDs
                if (normalizedMarkId === normalizedTargetId) {
                  // Calculate correct position for text nodes
                  const from = pos
                  const to = pos + (node.text?.length || 0)

                  console.log('[AnnotationUpdater] ✓ Match found at pos', pos)
                  updatePositions.push({ from, to, mark })
                  updated = true
                }
              }
            })
          })

          console.log('[AnnotationUpdater] All annotations in doc:', allAnnotations)
          console.log('[AnnotationUpdater] Positions to update:', updatePositions)

          // Apply updates if found
          if (updated && updatePositions.length > 0) {
            updatePositions.forEach(({ from, to, mark }) => {
              // Remove old mark
              tr.removeMark(from, to, mark.type)

              // Add new mark with updated type, preserving other attributes
              tr.addMark(from, to, mark.type.create({
                ...mark.attrs,
                type: newType,
              }))
            })

            // Add to history so it can be undone
            tr.setMeta('addToHistory', true)

            if (dispatch) {
              dispatch(tr)
            }

            console.log('[AnnotationUpdater] ✓ Update applied successfully')
            return true
          }

          console.warn('[AnnotationUpdater] ✗ No matching annotation found')
          return false
        },

      /**
       * Get all annotations in the document
       * Useful for debugging and testing
       */
      getAnnotations: () => ({ state }) => {
        const annotations: Array<{
          branchId: string
          type: string
          from: number
          to: number
          text: string
        }> = []

        state.doc.descendants((node, pos) => {
          if (!node.isText) return

          node.marks.forEach((mark) => {
            if (mark.type.name === 'annotation') {
              const branchId = mark.attrs.branchId || mark.attrs['data-branch'] || ''
              annotations.push({
                branchId,
                type: mark.attrs.type || 'note',
                from: pos,
                to: pos + (node.text?.length || 0),
                text: node.text || '',
              })
            }
          })
        })

        return annotations
      },
    }
  },
})

/**
 * Type augmentation for TipTap commands
 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    annotationUpdater: {
      /**
       * Update annotation type by branch ID
       */
      updateAnnotationType: (branchId: string, newType: AnnotationType) => ReturnType
      /**
       * Get all annotations in document
       */
      getAnnotations: () => any[]
    }
  }
}
