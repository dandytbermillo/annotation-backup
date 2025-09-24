import { Extension, type CommandProps } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, NodeSelection, type Transaction } from 'prosemirror-state'
import type { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model'
import { Decoration, DecorationSet } from 'prosemirror-view'

export type CollapsibleSelectionMode = 'none' | 'single' | 'range' | 'multi'

export interface CollapsibleSelectionItem {
  pos: number
  size: number
  attrs: Record<string, any>
}

export interface CollapsibleSelectionSnapshot {
  mode: CollapsibleSelectionMode
  anchor: number | null
  head: number | null
  blocks: CollapsibleSelectionItem[]
}

interface CollapsibleSelectionState extends CollapsibleSelectionSnapshot {
  decorations: DecorationSet
}

type SelectionMeta =
  | { type: 'clear' }
  | { type: 'set'; payload: CollapsibleSelectionSnapshot }

const pluginKey = new PluginKey<CollapsibleSelectionState>('collapsibleBlockSelection')

const emptyDecorations = DecorationSet.empty
const emptyState: CollapsibleSelectionState = {
  mode: 'none',
  anchor: null,
  head: null,
  blocks: [],
  decorations: emptyDecorations,
}

const isMacPlatform = () => {
  if (typeof window === 'undefined') return false
  return /Mac|iPod|iPhone|iPad/.test(window.navigator.platform)
}

const findCollapsibleBlockPos = (doc: ProseMirrorNode, schemaName: string, pos: number): number | null => {
  if (pos < 0 || pos > doc.content.size) {
    return null
  }
  let resolved: ResolvedPos
  try {
    resolved = doc.resolve(pos)
  } catch {
    return null
  }

  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    const node = resolved.node(depth)
    if (node.type.name === schemaName) {
      return depth === 0 ? 0 : resolved.before(depth)
    }
  }
  return null
}

const gatherCollapsibleBlocks = (doc: ProseMirrorNode, schemaName: string) => {
  const blocks: Array<{ pos: number; node: ProseMirrorNode }> = []
  doc.descendants((node, pos) => {
    if (node.type.name === schemaName) {
      blocks.push({ pos, node })
      return false
    }
    return true
  })
  return blocks
}

const buildItems = (doc: ProseMirrorNode, schemaName: string, positions: number[]): CollapsibleSelectionItem[] => {
  const uniqSorted = Array.from(new Set(positions)).sort((a, b) => a - b)
  const items: CollapsibleSelectionItem[] = []
  for (const pos of uniqSorted) {
    const node = doc.nodeAt(pos)
    if (!node || node.type.name !== schemaName) continue
    items.push({
      pos,
      size: node.nodeSize,
      attrs: { ...node.attrs },
    })
  }
  return items
}

const createDecorations = (doc: ProseMirrorNode, schemaName: string, blocks: CollapsibleSelectionItem[]): DecorationSet => {
  if (!blocks.length) {
    return emptyDecorations
  }

  const decorations = blocks
    .map(({ pos }) => {
      const node = doc.nodeAt(pos)
      if (!node || node.type.name !== schemaName) return null
      const to = pos + node.nodeSize
      return Decoration.node(pos, to, {
        'data-collapsible-selected': 'true',
        class: 'collapsible-block--selected',
      })
    })
    .filter((dec): dec is Decoration => dec !== null)

  return DecorationSet.create(doc, decorations)
}

const snapshotEquals = (a: CollapsibleSelectionSnapshot, b: CollapsibleSelectionSnapshot): boolean => {
  if (a.mode !== b.mode) return false
  if (a.anchor !== b.anchor) return false
  if (a.head !== b.head) return false
  if (a.blocks.length !== b.blocks.length) return false
  for (let i = 0; i < a.blocks.length; i += 1) {
    if (a.blocks[i].pos !== b.blocks[i].pos || a.blocks[i].size !== b.blocks[i].size) {
      return false
    }
    const attrsA = a.blocks[i].attrs
    const attrsB = b.blocks[i].attrs
    const keysA = Object.keys(attrsA ?? {})
    const keysB = Object.keys(attrsB ?? {})
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (attrsA[key] !== attrsB[key]) {
        return false
      }
    }
  }
  return true
}

const remapStateAfterDocChange = (
  state: CollapsibleSelectionState,
  tr: Transaction,
  doc: ProseMirrorNode,
  schemaName: string,
): CollapsibleSelectionState => {
  if (!state.blocks.length) {
    return state
  }

  const mappedBlocks: CollapsibleSelectionItem[] = []
  for (const block of state.blocks) {
    const mappedPos = tr.mapping.map(block.pos, -1)
    const node = doc.nodeAt(mappedPos)
    if (!node || node.type.name !== schemaName) {
      continue
    }
    mappedBlocks.push({
      pos: mappedPos,
      size: node.nodeSize,
      attrs: { ...node.attrs },
    })
  }

  if (!mappedBlocks.length) {
    return {
      ...emptyState,
      decorations: emptyDecorations,
    }
  }

  const mappedAnchor = state.anchor != null ? tr.mapping.map(state.anchor, -1) : null
  const mappedHead = state.head != null ? tr.mapping.map(state.head, -1) : null

  return {
    mode: mappedBlocks.length === 1 && state.mode !== 'multi' ? 'single' : state.mode,
    anchor: mappedAnchor,
    head: mappedHead,
    blocks: mappedBlocks,
    decorations: createDecorations(doc, schemaName, mappedBlocks),
  }
}

const toSnapshot = (state: CollapsibleSelectionState): CollapsibleSelectionSnapshot => ({
  mode: state.mode,
  anchor: state.anchor,
  head: state.head,
  blocks: state.blocks.map(block => ({ ...block })),
})

const isModKey = (event: MouseEvent) => {
  const isMac = isMacPlatform()
  return isMac ? event.metaKey : event.ctrlKey
}

const findAdjacentBlock = (
  doc: ProseMirrorNode,
  blocks: Array<{ pos: number; node: ProseMirrorNode }>,
  currentPos: number,
  direction: 'forward' | 'backward',
) => {
  const index = blocks.findIndex(block => block.pos === currentPos)
  if (index === -1) return null
  const nextIndex = direction === 'forward' ? index + 1 : index - 1
  if (nextIndex < 0 || nextIndex >= blocks.length) {
    return null
  }
  return blocks[nextIndex]
}

const collectRangeBetween = (
  blocks: Array<{ pos: number; node: ProseMirrorNode }>,
  anchor: number,
  head: number,
) => {
  const anchorIndex = blocks.findIndex(block => block.pos === anchor)
  const headIndex = blocks.findIndex(block => block.pos === head)
  if (anchorIndex === -1 || headIndex === -1) {
    return []
  }
  const [from, to] = anchorIndex <= headIndex ? [anchorIndex, headIndex] : [headIndex, anchorIndex]
  return blocks.slice(from, to + 1).map(block => block.pos)
}

const ensureSingleSelection = (props: CommandProps, pos: number): boolean => {
  const { state, dispatch } = props
  const schemaName = state.schema.nodes.collapsibleBlock?.name
  if (!schemaName || typeof pos !== 'number') {
    return false
  }
  const node = state.doc.nodeAt(pos)
  if (!node || node.type.name !== schemaName) {
    return false
  }

  const items = buildItems(state.doc, schemaName, [pos])
  if (!items.length) {
    return false
  }

  const tr = state.tr
  tr.setMeta(pluginKey, { type: 'set', payload: { mode: 'single', anchor: pos, head: pos, blocks: items } } satisfies SelectionMeta)
  tr.setSelection(NodeSelection.create(state.doc, pos))
  tr.setMeta('addToHistory', false)
  dispatch?.(tr.scrollIntoView())
  return true
}

const extension = Extension.create({
  name: 'collapsibleBlockSelection',

  addStorage() {
    return {
      snapshot: toSnapshot(emptyState) as CollapsibleSelectionSnapshot,
    }
  },

  addCommands() {
    const self = this
    const getSchemaName = () => self.editor?.schema.nodes.collapsibleBlock?.name ?? 'collapsibleBlock'

    return {
      selectCollapsibleBlock:
        (pos?: number) => props => {
          const { state } = props
          const schemaName = getSchemaName()
          let targetPos = pos
          if (typeof targetPos !== 'number') {
            const selectionPos = findCollapsibleBlockPos(state.doc, schemaName, state.selection.from)
            if (selectionPos == null) {
              return false
            }
            targetPos = selectionPos
          }
          return ensureSingleSelection(props, targetPos)
        },

      toggleCollapsibleBlockSelection:
        (pos: number) => props => {
          const { state } = props
          const schemaName = getSchemaName()
          const blockPos = findCollapsibleBlockPos(state.doc, schemaName, pos)
          if (blockPos == null) {
            return false
          }
          const existing = pluginKey.getState(state) ?? emptyState
          const alreadySelected = existing.blocks.some(block => block.pos === blockPos)
          let nextPositions: number[]
          if (alreadySelected) {
            nextPositions = existing.blocks.filter(block => block.pos !== blockPos).map(block => block.pos)
          } else {
            nextPositions = [...existing.blocks.map(block => block.pos), blockPos]
          }

          if (!nextPositions.length) {
            const tr = state.tr
            tr.setMeta(pluginKey, { type: 'clear' } satisfies SelectionMeta)
            tr.setSelection(TextSelection.create(state.doc, blockPos))
            tr.setMeta('addToHistory', false)
            props.dispatch?.(tr)
            return true
          }

          nextPositions.sort((a, b) => a - b)
          const items = buildItems(state.doc, schemaName, nextPositions)
          const nextState: CollapsibleSelectionState = {
            mode: items.length === 1 ? 'single' : 'multi',
            anchor: existing.anchor ?? blockPos,
            head: blockPos,
            blocks: items,
            decorations: createDecorations(state.doc, schemaName, items),
          }
          const tr = state.tr
          tr.setMeta(pluginKey, { type: 'set', payload: toSnapshot(nextState) } satisfies SelectionMeta)
          tr.setSelection(NodeSelection.create(state.doc, blockPos))
          tr.setMeta('addToHistory', false)
          props.dispatch?.(tr.scrollIntoView())
          return true
        },

      setCollapsibleBlockRange:
        (pos: number) => props => {
          const { state } = props
          const schemaName = getSchemaName()
          const blockPos = findCollapsibleBlockPos(state.doc, schemaName, pos)
          if (blockPos == null) {
            return false
          }
          const existing = pluginKey.getState(state) ?? emptyState
          let anchor = existing.anchor
          if (anchor == null) {
            const anchorPos = findCollapsibleBlockPos(state.doc, schemaName, state.selection.anchor)
            if (anchorPos != null) {
              anchor = anchorPos
            } else {
              const headPos = findCollapsibleBlockPos(state.doc, schemaName, state.selection.head)
              if (headPos != null) {
                anchor = headPos
              } else {
                anchor = findCollapsibleBlockPos(state.doc, schemaName, state.selection.from)
              }
            }
          }
          if (anchor == null) {
            anchor = blockPos
          }
          const blocks = gatherCollapsibleBlocks(state.doc, schemaName)
          const positions = collectRangeBetween(blocks, anchor, blockPos)
          if (!positions.length) {
            return false
          }
          const items = buildItems(state.doc, schemaName, positions)
          const nextState: CollapsibleSelectionState = {
            mode: positions.length === 1 ? 'single' : 'range',
            anchor,
            head: blockPos,
            blocks: items,
            decorations: createDecorations(state.doc, schemaName, items),
          }
          const tr = state.tr
          tr.setMeta(pluginKey, { type: 'set', payload: toSnapshot(nextState) } satisfies SelectionMeta)
          tr.setSelection(NodeSelection.create(state.doc, blockPos))
          tr.setMeta('addToHistory', false)
          props.dispatch?.(tr.scrollIntoView())
          return true
        },

      extendCollapsibleBlockSelection:
        (direction: 'forward' | 'backward') => props => {
          const { state } = props
          const schemaName = getSchemaName()
          const existing = pluginKey.getState(state) ?? emptyState
          let anchor = existing.anchor
          if (anchor == null) {
            const anchorPos = findCollapsibleBlockPos(state.doc, schemaName, state.selection.anchor)
            if (anchorPos != null) {
              anchor = anchorPos
            } else {
              const headPos = findCollapsibleBlockPos(state.doc, schemaName, state.selection.head)
              if (headPos != null) {
                anchor = headPos
              } else {
                anchor = findCollapsibleBlockPos(state.doc, schemaName, state.selection.from)
              }
            }
          }
          if (anchor == null) {
            return false
          }
          const blocks = gatherCollapsibleBlocks(state.doc, schemaName)
          const referencePos = existing.head ?? anchor
          const nextBlock = findAdjacentBlock(state.doc, blocks, referencePos, direction)
          if (!nextBlock) {
            return false
          }
          const positions = collectRangeBetween(blocks, anchor, nextBlock.pos)
          if (!positions.length) {
            return false
          }
          const items = buildItems(state.doc, schemaName, positions)
          const nextState: CollapsibleSelectionState = {
            mode: positions.length === 1 ? 'single' : 'range',
            anchor,
            head: nextBlock.pos,
            blocks: items,
            decorations: createDecorations(state.doc, schemaName, items),
          }
          const tr = state.tr
          tr.setMeta(pluginKey, { type: 'set', payload: toSnapshot(nextState) } satisfies SelectionMeta)
          tr.setSelection(NodeSelection.create(state.doc, nextBlock.pos))
          tr.setMeta('addToHistory', false)
          props.dispatch?.(tr.scrollIntoView())
          return true
        },

      clearCollapsibleBlockSelection: () => props => {
        const { state } = props
        const existing = pluginKey.getState(state)
        if (!existing || existing.mode === 'none') {
          return false
        }
        const tr = state.tr
        tr.setMeta(pluginKey, { type: 'clear' } satisfies SelectionMeta)
        tr.setSelection(TextSelection.create(state.doc, tr.selection.from))
        tr.setMeta('addToHistory', false)
        props.dispatch?.(tr)
        return true
      },

      collapseSelectedCollapsibleBlocks: () => props => {
        const { state } = props
        const schema = state.schema
        const type = schema.nodes.collapsibleBlock
        if (!type) {
          return false
        }
        const selectionState = pluginKey.getState(state) ?? emptyState
        const targets = selectionState.blocks.length
          ? selectionState.blocks
          : (() => {
              const pos = findCollapsibleBlockPos(state.doc, type.name, state.selection.from)
              if (pos == null) return []
              return buildItems(state.doc, type.name, [pos])
            })()
        if (!targets.length) {
          return false
        }
        let tr = state.tr
        for (const block of targets) {
          const node = tr.doc.nodeAt(block.pos)
          if (!node || node.type !== type) continue
          if (node.attrs.collapsed) continue
          tr = tr.setNodeMarkup(block.pos, type, { ...node.attrs, collapsed: true }, node.marks)
        }
        tr.setMeta('addToHistory', true)
        if (selectionState.blocks.length) {
          const nextSnapshot: CollapsibleSelectionSnapshot = {
            mode: selectionState.mode,
            anchor: selectionState.anchor,
            head: selectionState.head,
            blocks: buildItems(tr.doc, type.name, targets.map(target => target.pos)),
          }
          tr.setMeta(pluginKey, { type: 'set', payload: nextSnapshot } satisfies SelectionMeta)
          props.dispatch?.(tr.scrollIntoView())
        } else {
          props.dispatch?.(tr.scrollIntoView())
        }
        return true
      },

      expandSelectedCollapsibleBlocks: () => props => {
        const { state } = props
        const type = state.schema.nodes.collapsibleBlock
        if (!type) {
          return false
        }
        const selectionState = pluginKey.getState(state) ?? emptyState
        const targets = selectionState.blocks.length
          ? selectionState.blocks
          : (() => {
              const pos = findCollapsibleBlockPos(state.doc, type.name, state.selection.from)
              if (pos == null) return []
              return buildItems(state.doc, type.name, [pos])
            })()
        if (!targets.length) {
          return false
        }
        let tr = state.tr
        for (const block of targets) {
          const node = tr.doc.nodeAt(block.pos)
          if (!node || node.type !== type) continue
          if (!node.attrs.collapsed) continue
          tr = tr.setNodeMarkup(block.pos, type, { ...node.attrs, collapsed: false }, node.marks)
        }
        tr.setMeta('addToHistory', true)
        if (selectionState.blocks.length) {
          const nextSnapshot: CollapsibleSelectionSnapshot = {
            mode: selectionState.mode,
            anchor: selectionState.anchor,
            head: selectionState.head,
            blocks: buildItems(tr.doc, type.name, targets.map(target => target.pos)),
          }
          tr.setMeta(pluginKey, { type: 'set', payload: nextSnapshot } satisfies SelectionMeta)
          props.dispatch?.(tr.scrollIntoView())
        } else {
          props.dispatch?.(tr.scrollIntoView())
        }
        return true
      },

      deleteSelectedCollapsibleBlocks: () => props => {
        const { state } = props
        const type = state.schema.nodes.collapsibleBlock
        if (!type) {
          return false
        }
        const selectionState = pluginKey.getState(state) ?? emptyState
        const targets = selectionState.blocks.length
          ? selectionState.blocks
          : (() => {
              const pos = findCollapsibleBlockPos(state.doc, type.name, state.selection.from)
              if (pos == null) return []
              return buildItems(state.doc, type.name, [pos])
            })()
        if (!targets.length) {
          return false
        }

        let tr = state.tr
        const sortedTargets = [...targets].sort((a, b) => b.pos - a.pos)
        for (const block of sortedTargets) {
          const node = tr.doc.nodeAt(block.pos)
          if (!node || node.type !== type) continue
          tr = tr.delete(block.pos, block.pos + node.nodeSize)
        }
        const newPos = Math.max(0, sortedTargets[sortedTargets.length - 1].pos - 1)
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(newPos, tr.doc.content.size))))
        tr.setMeta(pluginKey, { type: 'clear' } satisfies SelectionMeta)
        tr.setMeta('addToHistory', true)
        props.dispatch?.(tr.scrollIntoView())
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Shift-ArrowDown': () => this.editor?.commands.extendCollapsibleBlockSelection('forward') ?? false,
      'Shift-ArrowUp': () => this.editor?.commands.extendCollapsibleBlockSelection('backward') ?? false,
      Escape: () => this.editor?.commands.clearCollapsibleBlockSelection() ?? false,
    }
  },

  addProseMirrorPlugins() {
    const self = this
    const schemaName = self.editor?.schema.nodes.collapsibleBlock?.name ?? 'collapsibleBlock'

    return [
      new Plugin<CollapsibleSelectionState>({
        key: pluginKey,
        state: {
          init: () => ({ ...emptyState }),
          apply: (tr, prev, oldState, newState) => {
            let state = prev
            if (tr.docChanged && state.blocks.length) {
              state = remapStateAfterDocChange(state, tr, newState.doc, schemaName)
            }

            const meta = tr.getMeta(pluginKey) as SelectionMeta | undefined
          if (meta?.type === 'clear') {
            state = { ...emptyState }
          } else if (meta?.type === 'set') {
            const items = buildItems(newState.doc, schemaName, meta.payload.blocks.map(block => block.pos))
            state = {
              mode: meta.payload.mode,
              anchor: meta.payload.anchor,
              head: meta.payload.head,
              blocks: items,
              decorations: createDecorations(newState.doc, schemaName, items),
            }
          }

          const nextSnapshot = toSnapshot(state)
          const changed = !snapshotEquals(self.storage.snapshot, nextSnapshot)
          self.storage.snapshot = nextSnapshot
          if (changed) {
            self.editor?.emit('collapsible-selection-change', nextSnapshot)
          }

          return state
        },
        },
        props: {
          decorations: state => state ? state.decorations : emptyDecorations,
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null
              if (!target) return false
              const headerEl = target.closest('[data-collapsible-header]')
              if (!headerEl) return false

              const coords = { left: event.clientX, top: event.clientY }
              const resolved = view.posAtCoords(coords)
              if (!resolved) return false

              const blockPos = findCollapsibleBlockPos(view.state.doc, schemaName, resolved.pos)
              if (blockPos == null) {
                return false
              }

              if (event.shiftKey) {
                event.preventDefault()
                event.stopPropagation()
                self.editor?.commands.setCollapsibleBlockRange(blockPos)
                return true
              }

              if (isModKey(event)) {
                event.preventDefault()
                event.stopPropagation()
                self.editor?.commands.toggleCollapsibleBlockSelection(blockPos)
                return true
              }

              event.preventDefault()
              event.stopPropagation()
              const tr = view.state.tr
              tr.setSelection(TextSelection.create(view.state.doc, resolved.pos))
              tr.setMeta('addToHistory', false)
              view.dispatch(tr)
              self.editor?.commands.selectCollapsibleBlock(blockPos)
              return true
            },
          },
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement | null
            if (!target) return false
            const headerEl = target.closest('[data-collapsible-header]')
            if (!headerEl) return false

            const coords = { left: event.clientX, top: event.clientY }
            const resolved = view.posAtCoords(coords)
            if (!resolved) return false

            const blockPos = findCollapsibleBlockPos(view.state.doc, schemaName, resolved.pos)
            if (blockPos == null) {
              return false
            }

            event.preventDefault()
            view.focus()
            self.editor?.commands.selectCollapsibleBlock(blockPos)
            return true
          },
        },
        view() {
          return {}
        },
      }),
    ]
  },
})

export const CollapsibleBlockSelection = extension
export type CollapsibleBlockSelectionStorage = {
  snapshot: CollapsibleSelectionSnapshot
}
