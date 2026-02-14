/**
 * Provenance Badge — Dev-only badge visibility tests
 *
 * Validates the PROVENANCE_STYLES mapping and the ProvenanceBadge component
 * rendering logic. Since @testing-library/react is not available, we test
 * the component's output via React.createElement + snapshot-style assertions.
 */

import React from 'react'
import ReactDOMServer from 'react-dom/server'
import { ChatMessageList } from '@/components/chat/ChatMessageList'
import type { ChatProvenance } from '@/lib/chat/chat-navigation-context'
import type { ChatMessage } from '@/lib/chat/chat-navigation-context'

const baseMessage: ChatMessage = {
  id: 'msg-1',
  role: 'assistant',
  content: 'Navigating to Links Panel D.',
  timestamp: new Date('2026-02-11T10:00:00Z'),
  isError: false,
}

const defaultProps = {
  messages: [baseMessage],
  initialMessageCount: 0,
  isLoading: false,
  onSelectOption: jest.fn(),
  onSuggestionClick: jest.fn(),
}

describe('ProvenanceBadge', () => {
  it('renders badge when provenanceMap contains the message ID', () => {
    const map = new Map<string, ChatProvenance>([['msg-1', 'llm_executed']])
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ChatMessageList, { ...defaultProps, provenanceMap: map })
    )
    expect(html).toContain('Auto-Executed')
    expect(html).toContain('bg-blue-900/50')
  })

  it('does not render badge when provenanceMap is undefined (production gate)', () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ChatMessageList, { ...defaultProps, provenanceMap: undefined })
    )
    expect(html).not.toContain('Auto-Executed')
    expect(html).not.toContain('Deterministic')
    expect(html).not.toContain('LLM-Influenced')
  })

  it('does not render badge when message ID is not in provenanceMap', () => {
    const map = new Map<string, ChatProvenance>([['msg-other', 'deterministic']])
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ChatMessageList, { ...defaultProps, provenanceMap: map })
    )
    expect(html).not.toContain('Deterministic')
  })

  it('renders correct style for each provenance type', () => {
    const cases: Array<{ type: ChatProvenance; label: string; cssClass: string }> = [
      { type: 'deterministic', label: 'Deterministic', cssClass: 'bg-green-900/50' },
      { type: 'llm_executed', label: 'Auto-Executed', cssClass: 'bg-blue-900/50' },
      { type: 'llm_influenced', label: 'LLM-Influenced', cssClass: 'bg-yellow-900/50' },
    ]

    for (const { type, label, cssClass } of cases) {
      const map = new Map<string, ChatProvenance>([['msg-1', type]])
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ChatMessageList, { ...defaultProps, provenanceMap: map })
      )
      expect(html).toContain(label)
      expect(html).toContain(cssClass)
    }
  })
})
