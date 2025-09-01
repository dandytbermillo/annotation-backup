import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { CollaborationProvider } from '@/lib/yjs-provider'
import { trackTooltipShown } from './performance-decorations'

export const annotationDecorationsKey = new PluginKey('annotationDecorations')

interface HoverState { pos: number; node: any; branchId: string }

export const AnnotationDecorations = () => {
  return new Plugin({
    key: annotationDecorationsKey,
    state: {
      init() { return { decorations: DecorationSet.empty, hoveredAnnotation: null as HoverState | null, tooltipVisible: false } },
      apply(tr, value, _oldState, newState) {
        const annotationDecorations: Decoration[] = []
        tr.doc.descendants((node, pos) => {
          if (!node.isText) return
          node.marks.forEach(mark => {
            if (mark.type.name === 'annotation') {
              const from = pos
              const to = pos + node.nodeSize
              const branchId = mark.attrs.branchId || mark.attrs['data-branch']
              const decoration = Decoration.inline(from, to, { class: 'annotation-hover-target', 'data-branch-id': branchId, 'data-annotation-type': mark.attrs.type })
              annotationDecorations.push(decoration)
            }
          })
        })
        return { decorations: DecorationSet.create(newState.doc, annotationDecorations), hoveredAnnotation: value.hoveredAnnotation, tooltipVisible: value.tooltipVisible }
      }
    },
    props: {
      decorations(state) { return this.getState(state)?.decorations },
      handleDOMEvents: {
        mouseover(_view, event) {
          const annotationEl = (event.target as HTMLElement).closest('.annotation-hover-target') as HTMLElement
          if (annotationEl) {
            const branchId = annotationEl.getAttribute('data-branch-id')
            const type = annotationEl.getAttribute('data-annotation-type')
            if (branchId) { showAnnotationTooltip(annotationEl, branchId!, type || 'note'); annotationEl.classList.add('annotation-hovered') }
          }
          return false
        },
        mouseout(_view, event) {
          const annotationEl = (event.target as HTMLElement).closest('.annotation-hover-target') as HTMLElement
          if (annotationEl) { hideAnnotationTooltip(); annotationEl.classList.remove('annotation-hovered') }
          return false
        },
        click(_view, event) {
          const annotationEl = (event.target as HTMLElement).closest('.annotation-hover-target') as HTMLElement
          if (annotationEl) { annotationEl.classList.add('annotation-clicked'); setTimeout(() => { annotationEl.classList.remove('annotation-clicked') }, 300); createRippleEffect(annotationEl, event as MouseEvent) }
          return false
        }
      }
    }
  })
}

let tooltipElement: HTMLDivElement | null = null
let tooltipTimeout: NodeJS.Timeout | null = null

function showAnnotationTooltip(element: HTMLElement, branchId: string, type: string) {
  if (tooltipTimeout) clearTimeout(tooltipTimeout)
  if (!tooltipElement) { tooltipElement = document.createElement('div'); tooltipElement.className = 'annotation-tooltip'; document.body.appendChild(tooltipElement) }
  const provider = CollaborationProvider.getInstance()
  const branchesMap = provider.getBranchesMap()
  const branchData = branchesMap.get(branchId)
  if (branchData) {
    const branch = JSON.parse(JSON.stringify(branchData))
    const preview = branch.content ? branch.content.replace(/<[^>]*>/g, '').substring(0, 150) + '...' : 'No content yet'
    tooltipElement.innerHTML = `
      <div class="tooltip-header"><span class="tooltip-icon">${getTypeIcon(type)}</span><span class="tooltip-title">${branch.title || 'Untitled'}</span></div>
      <div class="tooltip-content">${preview}</div>
      <div class="tooltip-footer">Click to open panel</div>`
    const rect = element.getBoundingClientRect(); const tooltipRect = tooltipElement.getBoundingClientRect()
    let top = rect.top - tooltipRect.height - 10; let left = rect.left + (rect.width - tooltipRect.width) / 2
    if (top < 10) top = rect.bottom + 10
    if (left < 10) left = 10
    if (left + tooltipRect.width > window.innerWidth - 10) left = window.innerWidth - tooltipRect.width - 10
    tooltipElement.style.top = `${top}px`; tooltipElement.style.left = `${left}px`; tooltipElement.classList.add('visible')
    trackTooltipShown()
  }
}

function hideAnnotationTooltip() {
  if (tooltipTimeout) clearTimeout(tooltipTimeout)
  tooltipTimeout = setTimeout(() => { if (tooltipElement) tooltipElement.classList.remove('visible') }, 300)
}

function getTypeIcon(type: string) { const icons = { note: '📝', explore: '🔍', promote: '⭐' } as const; return (icons as any)[type] || '📝' }

function createRippleEffect(element: HTMLElement, event: MouseEvent) {
  const ripple = document.createElement('span'); ripple.className = 'annotation-ripple'
  const rect = element.getBoundingClientRect(); const size = Math.max(rect.width, rect.height)
  const x = event.clientX - rect.left - size / 2; const y = event.clientY - rect.top - size / 2
  ripple.style.width = ripple.style.height = size + 'px'; ripple.style.left = x + 'px'; ripple.style.top = y + 'px'
  element.appendChild(ripple); setTimeout(() => ripple.remove(), 600)
}

