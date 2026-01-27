/**
 * Unit tests for panel-command-matcher.ts
 * Covers typo normalization and fuzzy matching for panel commands.
 */

import { matchVisiblePanelCommand, type VisibleWidget } from '@/lib/chat/panel-command-matcher'

const visibleWidgets: VisibleWidget[] = [
  { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
  { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  { id: 'recent', title: 'Recent', type: 'recent' },
]

describe('matchVisiblePanelCommand', () => {
  test('handles repeated letter typos (llink panel → partial match)', () => {
    const result = matchVisiblePanelCommand('llink panel', visibleWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.map(m => m.id).sort()).toEqual(['links-panel-d', 'links-panel-e'])
  })

  test('handles fuzzy typos (limk panels → partial match)', () => {
    const result = matchVisiblePanelCommand('limk panels', visibleWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.map(m => m.id).sort()).toEqual(['links-panel-d', 'links-panel-e'])
  })

  test('handles command typos with badge (opwn linkk panel d → exact match)', () => {
    const result = matchVisiblePanelCommand('opwn linkk panel d', visibleWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.map(m => m.id)).toEqual(['links-panel-d'])
  })

  test('handles command typo for recent (opne recent → exact match)', () => {
    const result = matchVisiblePanelCommand('opne recent', visibleWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.map(m => m.id)).toEqual(['recent'])
  })
})
