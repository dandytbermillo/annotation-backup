import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { getPlainProvider } from '@/lib/provider-switcher'
import { trackTooltipShown } from './performance-decorations'

export const annotationDecorationsKey = new PluginKey('annotationDecorations')

let hoverIcon: HTMLDivElement | null = null
let isOverIcon = false
let isOverTarget = false
let isOverTooltip = false
let hoverIconHideTimeout: NodeJS.Timeout | null = null
let tooltipHideTimeout: NodeJS.Timeout | null = null

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function normalizeIds(branchId: string) {
  if (!branchId) return { uiId: '', dbId: '' }
  if (branchId.startsWith('branch-')) return { uiId: branchId, dbId: branchId.slice(7) }
  if (UUID_RE.test(branchId)) return { uiId: `branch-${branchId}`, dbId: branchId }
  return { uiId: branchId, dbId: branchId }
}

function resolveContextFrom(el: HTMLElement) {
  const root = el.closest('.tiptap-editor-wrapper') || document.body
  const textbox = root.querySelector('[role="textbox"]') as HTMLElement | null
  const noteId = textbox?.getAttribute('data-note') || ''
  const panelId = textbox?.getAttribute('data-panel') || ''
  return { noteId, panelId }
}

function stripHtml(html: string): string {
  try { return html.replace(/<[^>]*>/g, '') } catch { return html || '' }
}

function extractTextFromPMJSON(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  
  // Handle text nodes directly
  if (node.type === 'text' && node.text) {
    return node.text
  }
  
  // Handle any node with content array (doc, paragraph, etc.)
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromPMJSON).join(' ').trim()
  }
  
  // Legacy support for direct text property
  if (node.text) return node.text
  
  return ''
}

function extractPreviewFromDoc(content: any): string | null {
  if (!content) return null
  if (typeof content === 'string') {
    const s = content.trim()
    if ((s.startsWith('{') || s.startsWith('['))) {
      try { return extractTextFromPMJSON(JSON.parse(s)) } catch { return stripHtml(s) }
    }
    return stripHtml(s)
  }
  if (typeof content === 'object') {
    try { return extractTextFromPMJSON(content) } catch { return null }
  }
  return null
}

function truncate(s: string, n: number): string { return !s ? '' : (s.length > n ? s.slice(0, n) + '...' : s) }
function capitalize(s: string): string { return !s ? '' : (s.charAt(0).toUpperCase() + s.slice(1)) }
function getTypeIcon(type: string) { const m = { note: '📝', explore: '🔍', promote: '⭐' } as const; return (m as any)[type] || '📝' }

export const AnnotationDecorations = () => new Plugin({
  key: annotationDecorationsKey,
  state: {
    init() {
      return { decorations: DecorationSet.empty }
    },
    apply(tr, _value, _old, newState) {
      const decos: Decoration[] = []
      tr.doc.descendants((node, pos) => {
        if (!node.isText) return
        node.marks.forEach(mark => {
          if (mark.type.name === 'annotation') {
            const from = pos
            const to = pos + node.nodeSize
            const branchId = mark.attrs.branchId || mark.attrs['data-branch']
            decos.push(Decoration.inline(from, to, {
              class: 'annotation-hover-target',
              'data-branch-id': branchId,
              'data-annotation-type': mark.attrs.type,
            }))
          }
        })
      })
      return { decorations: DecorationSet.create(newState.doc, decos) }
    }
  },
  props: {
    decorations(state) {
      // @ts-ignore
      return this.getState(state)?.decorations
    },
  },
  view(editorView) {
    let tooltipElement: HTMLDivElement | null = null
    let tooltipTimeout: NodeJS.Timeout | null = null

    function ensureTooltip() {
      if (!tooltipElement) {
        tooltipElement = document.createElement('div')
        tooltipElement.className = 'annotation-tooltip'
        document.body.appendChild(tooltipElement)
        tooltipElement.addEventListener('mouseenter', () => { isOverTooltip = true })
        tooltipElement.addEventListener('mouseleave', () => { isOverTooltip = false; hideAnnotationTooltipSoon() })
      }
    }

    function ensureHoverIcon() {
      if (hoverIcon) return
      hoverIcon = document.createElement('div')
      hoverIcon.className = 'annotation-hover-icon'
      hoverIcon.innerHTML = '🔎'
      hoverIcon.style.cssText = 'position:fixed;display:none;z-index:10000;pointer-events:auto;'
      document.body.appendChild(hoverIcon)
      hoverIcon.addEventListener('mouseenter', () => {
        isOverIcon = true
        if (hoverIconHideTimeout) { clearTimeout(hoverIconHideTimeout); hoverIconHideTimeout = null }
        if (tooltipHideTimeout) { clearTimeout(tooltipHideTimeout); tooltipHideTimeout = null }
        const branchId = hoverIcon!.getAttribute('data-branch-id') || ''
        const type = hoverIcon!.getAttribute('data-annotation-type') || 'note'
        showAnnotationTooltip(hoverIcon!, branchId, type)
      })
      hoverIcon.addEventListener('mouseleave', () => { isOverIcon = false; hideHoverIconSoon(); hideAnnotationTooltipSoon() })
    }

    function positionHoverIcon(x: number, y: number) {
      const OFFSET = 8, W = 22, H = 22
      const left = Math.min(x + OFFSET, window.innerWidth - W - 10)
      const top = Math.max(y - OFFSET - H/2, 10)
      if (hoverIcon) { hoverIcon.style.left = `${left}px`; hoverIcon.style.top = `${top}px` }
    }

    function showHoverIcon(targetEl: HTMLElement, branchId: string, type: string, evt: MouseEvent) {
      ensureHoverIcon()
      if (hoverIcon) {
        const ctx = resolveContextFrom(targetEl)
        hoverIcon.dataset.noteId = ctx.noteId || ''
        hoverIcon.dataset.panelId = ctx.panelId || ''
        hoverIcon.setAttribute('data-branch-id', branchId)
        hoverIcon.setAttribute('data-annotation-type', type)
        positionHoverIcon(evt.clientX, evt.clientY)
        hoverIcon.style.display = 'block'
      }
      if (hoverIconHideTimeout) { clearTimeout(hoverIconHideTimeout); hoverIconHideTimeout = null }
    }

    function hideHoverIconSoon() {
      if (hoverIconHideTimeout) clearTimeout(hoverIconHideTimeout)
      hoverIconHideTimeout = setTimeout(() => { if (!isOverIcon && !isOverTarget && hoverIcon) hoverIcon.style.display = 'none' }, 300)
    }

    function hideAnnotationTooltipSoon() {
      if (tooltipHideTimeout) clearTimeout(tooltipHideTimeout)
      tooltipHideTimeout = setTimeout(() => { if (!isOverTooltip && !isOverIcon && tooltipElement) tooltipElement.classList.remove('visible') }, 300)
    }

    function showAnnotationTooltip(el: HTMLElement, rawBranchId: string, type: string) {
      if (!rawBranchId) return
      if (tooltipTimeout) clearTimeout(tooltipTimeout)
      ensureTooltip()

      const noteId = (el as any).dataset?.noteId || resolveContextFrom(el).noteId || ''
      const { uiId } = normalizeIds(rawBranchId)

      if (tooltipElement) tooltipElement.dataset.branchId = uiId

      const ds = (window as any).canvasDataStore
      const plainProvider = getPlainProvider()
      const dsBranch = ds?.get?.(uiId) || null
      
      // Try to get provider document cache (but only as fallback)
      let docContent: any = null
      if (plainProvider && noteId) {
        try { docContent = plainProvider.getDocument(noteId, uiId) || null } catch {}
      }

      // Unified precedence: branch.content → provider doc → originalText
      const titleText = dsBranch?.title || `${capitalize(type)}${dsBranch?.originalText ? ` on "${truncate(dsBranch.originalText, 30)}"` : ''}`
      const previewText = (dsBranch?.content ? stripHtml(String(dsBranch.content)) : '')
        || extractPreviewFromDoc(docContent)
        || (dsBranch?.originalText || '')

      function renderPreview(text: string) {
        const headerType = dsBranch?.type || type
        const safe = (text || 'No notes added yet').substring(0, 150)
        tooltipElement!.innerHTML = `
          <div class="tooltip-header">
            <span class="tooltip-icon">${getTypeIcon(headerType)}</span>
            <span class="tooltip-title">${titleText || `${capitalize(type)} annotation`}</span>
          </div>
          <div class="tooltip-content">${safe}${(text && text.length > 150) ? '...' : ''}</div>
          <div class="tooltip-footer">Click to open panel</div>
        `
      }

      if (titleText || previewText) renderPreview(previewText)
      else tooltipElement!.innerHTML = `
        <div class="tooltip-header">
          <span class="tooltip-icon">${getTypeIcon(type)}</span>
          <span class="tooltip-title">${capitalize(type)} annotation</span>
        </div>
        <div class="tooltip-content">Loading notes...</div>
        <div class="tooltip-footer">Click to open panel</div>
      `

      const rect = el.getBoundingClientRect()
      const trect = tooltipElement!.getBoundingClientRect()
      let top = rect.top - trect.height - 10
      let left = rect.left + (rect.width - trect.width) / 2
      if (top < 10) top = rect.bottom + 10
      if (left < 10) left = 10
      if (left + trect.width > window.innerWidth - 10) left = window.innerWidth - trect.width - 10
      tooltipElement!.style.top = `${top}px`
      tooltipElement!.style.left = `${left}px`
      tooltipElement!.classList.add('visible')
      trackTooltipShown()

      // Late fallback to API - try to get branch metadata if not in cache
      if (noteId && !previewText && !dsBranch) {
        const currentKey = uiId
        const dbId = normalizeIds(rawBranchId).dbId
        
        fetch(`/api/postgres-offline/branches?noteId=${noteId}`)
          .then(res => res.ok ? res.json() : null)
          .then(branches => {
            if (!branches || !tooltipElement) return
            if (tooltipElement.dataset.branchId !== currentKey || !tooltipElement.classList.contains('visible')) return
            
            const branch = branches.find((b: any) => b.id === dbId)
            if (branch) {
              // Simple: just strip HTML from branch content
              let txt = ''
              if (branch.content) {
                txt = stripHtml(String(branch.content))
              } else if (branch.original_text || branch.originalText) {
                txt = branch.original_text || branch.originalText
              }
              
              if (txt) {
                renderPreview(txt)
              }
            }
          })
          .catch(() => {})
      }

      // Delayed retry: check canvasDataStore again after save debounce
      if (!previewText && !dsBranch) {
        const currentKey = uiId
        setTimeout(() => {
          if (!tooltipElement || tooltipElement.dataset.branchId !== currentKey || !tooltipElement.classList.contains('visible')) return
          try {
            // Re-check canvasDataStore which might have been populated
            const ds = (window as any).canvasDataStore
            const retryBranch = ds?.get?.(uiId)
            if (retryBranch) {
              // Simple: just strip HTML from branch content
              let txt = ''
              if (retryBranch.content) {
                txt = stripHtml(String(retryBranch.content))
              } else if (retryBranch.originalText) {
                txt = retryBranch.originalText
              }
              
              if (txt) {
                renderPreview(txt)
              }
            }
          } catch {}
        }, 900)
      }
    }

    const onOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      let el = target.closest('.annotation-hover-target') as HTMLElement
      if (!el) el = target.closest('.annotation') as HTMLElement
      if (!el) return
      if (!el.hasAttribute('data-hover-processed')) {
        el.setAttribute('data-hover-processed', 'true')
        isOverTarget = true
        const branchId = el.getAttribute('data-branch-id') || el.getAttribute('data-branch') || ''
        const type = el.getAttribute('data-annotation-type') || el.getAttribute('data-type') || 'note'
        showHoverIcon(el, branchId, type, event)
        el.classList.add('annotation-hovered')
      }
    }
    const onOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      let el = target.closest('.annotation-hover-target') as HTMLElement
      if (!el) el = target.closest('.annotation') as HTMLElement
      if (!el) return
      if (el.hasAttribute('data-hover-processed')) {
        el.removeAttribute('data-hover-processed')
        isOverTarget = false
        el.classList.remove('annotation-hovered')
        hideHoverIconSoon()
        hideAnnotationTooltipSoon()
      }
    }

    editorView.dom.addEventListener('mouseover', onOver)
    editorView.dom.addEventListener('mouseout', onOut)

    return {
      destroy() {
        editorView.dom.removeEventListener('mouseover', onOver)
        editorView.dom.removeEventListener('mouseout', onOut)
        if (hoverIcon && hoverIcon.parentNode) hoverIcon.parentNode.removeChild(hoverIcon)
        hoverIcon = null
        if (tooltipElement && tooltipElement.parentNode) tooltipElement.parentNode.removeChild(tooltipElement)
        tooltipElement = null
      }
    }
  }
})
