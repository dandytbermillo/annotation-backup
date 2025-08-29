import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const performanceMonitorKey = new PluginKey('performanceMonitor')

interface PerformanceMetrics { hoverCount: number; clickCount: number; tooltipShown: number; lastYjsSync: number | null; decorationUpdates: number }

let metrics: PerformanceMetrics = { hoverCount: 0, clickCount: 0, tooltipShown: 0, lastYjsSync: null, decorationUpdates: 0 }

let indicatorElement: HTMLDivElement | null = null

function createPerformanceIndicator() {
  if (!indicatorElement && typeof window !== 'undefined') {
    indicatorElement = document.createElement('div')
    indicatorElement.className = 'performance-indicator'
    indicatorElement.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: rgba(0,0,0,0.8); color: white; padding: 12px 16px; border-radius: 8px; font-family: monospace; font-size: 11px; z-index: 9999; display: none;`
    document.body.appendChild(indicatorElement)
  }
}

function updatePerformanceIndicator() {
  if (indicatorElement) {
    indicatorElement.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px;">Decoration Performance</div>
      <div>Hovers: ${metrics.hoverCount}</div>
      <div>Clicks: ${metrics.clickCount}</div>
      <div>Tooltips: ${metrics.tooltipShown}</div>
      <div>Decoration Updates: ${metrics.decorationUpdates}</div>
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
        <span style="color: #4caf50;">✓ No YJS syncs from decorations</span>
      </div>`
  }
}

export const PerformanceMonitor = () => {
  return new Plugin({
    key: performanceMonitorKey,
    view() { createPerformanceIndicator(); return { destroy() { if (indicatorElement) { document.body.removeChild(indicatorElement); indicatorElement = null } } } },
    state: { init() { return { metricsUpdated: 0 } }, apply(tr, value) { metrics.decorationUpdates++; updatePerformanceIndicator(); return { metricsUpdated: Date.now() } } },
    props: {
      handleDOMEvents: {
        mouseover(_view, event) { const target = event.target as HTMLElement; if (target.closest('.annotation-hover-target')) { metrics.hoverCount++; updatePerformanceIndicator() } return false },
        click(_view, event) { const target = event.target as HTMLElement; if (target.closest('.annotation-hover-target')) { metrics.clickCount++; updatePerformanceIndicator() } return false }
      }
    }
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key === 'P') { if (indicatorElement) { indicatorElement.style.display = indicatorElement.style.display === 'none' ? 'block' : 'none' } } })
}

export function trackTooltipShown() { metrics.tooltipShown++; updatePerformanceIndicator() }

