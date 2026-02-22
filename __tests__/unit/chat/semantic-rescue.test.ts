/**
 * Unit tests for trySemanticRescue — shared post-LLM guard utility.
 *
 * Tests the 5 hard guards and correct intent return values.
 */

import { trySemanticRescue } from '@/lib/chat/semantic-rescue'
import type { SessionState } from '@/lib/chat/intent-prompt'

const validLastAction: SessionState['lastAction'] = {
  type: 'open_panel',
  panelTitle: 'Recent',
  timestamp: Date.now() - 5000,
}

describe('trySemanticRescue', () => {
  // === Positive cases (all guards pass) ===

  it('returns explain_last_action for "what did I do before that?" when all guards pass', () => {
    const result = trySemanticRescue(
      'what did I do before that?',
      true,        // isSemanticLaneEnabled
      undefined,   // pendingOptions
      undefined,   // lastClarification
      validLastAction
    )
    expect(result).toBe('explain_last_action')
  })

  it('returns explain_last_action for noisy input with filler stripped', () => {
    const result = trySemanticRescue(
      'assistant explain what did I do before that? thank you',
      true,
      undefined,
      undefined,
      validLastAction
    )
    expect(result).toBe('explain_last_action')
  })

  it('returns last_action for "what did I just do?"', () => {
    const result = trySemanticRescue(
      'what did I just do?',
      true,
      undefined,
      undefined,
      validLastAction
    )
    expect(result).toBe('last_action')
  })

  it('returns last_action for "hey what did I do? thanks"', () => {
    const result = trySemanticRescue(
      'hey what did I do? thanks',
      true,
      undefined,
      undefined,
      validLastAction
    )
    expect(result).toBe('last_action')
  })

  // === Guard: isSemanticLaneEnabled ===

  it('returns null when isSemanticLaneEnabled is false', () => {
    const result = trySemanticRescue(
      'what did I do before that?',
      false,       // disabled
      undefined,
      undefined,
      validLastAction
    )
    expect(result).toBeNull()
  })

  // === Guard: pendingOptions ===

  it('returns null when pendingOptions has items', () => {
    const result = trySemanticRescue(
      'what did I do before that?',
      true,
      [{ label: 'Option 1' }], // pendingOptions present
      undefined,
      validLastAction
    )
    expect(result).toBeNull()
  })

  it('returns non-null when pendingOptions is empty array', () => {
    const result = trySemanticRescue(
      'what did I do before that?',
      true,
      [],          // empty array — guard passes
      undefined,
      validLastAction
    )
    expect(result).toBe('explain_last_action')
  })

  // === Guard: lastClarification ===

  it('returns null when lastClarification is truthy', () => {
    const result = trySemanticRescue(
      'what did I do before that?',
      true,
      undefined,
      { question: 'Which one?' }, // active clarification
      validLastAction
    )
    expect(result).toBeNull()
  })

  // === Guard: lastAction ===

  it('returns null when lastAction is undefined', () => {
    const result = trySemanticRescue(
      'what did I do before that?',
      true,
      undefined,
      undefined,
      undefined    // no lastAction
    )
    expect(result).toBeNull()
  })

  // === Guard: detectLocalSemanticIntent returns null ===

  it('returns null for non-matching input', () => {
    const result = trySemanticRescue(
      'tell me about the links panel',
      true,
      undefined,
      undefined,
      validLastAction
    )
    expect(result).toBeNull()
  })

  it('returns null for compound input (guard on original)', () => {
    const result = trySemanticRescue(
      'what did I do before that and open panel e',
      true,
      undefined,
      undefined,
      validLastAction
    )
    expect(result).toBeNull()
  })

  // === Type safety ===

  it('return type is assignable to SemanticRescueIntent | null', () => {
    const result: 'last_action' | 'explain_last_action' | null = trySemanticRescue(
      'what did I do before that?',
      true,
      undefined,
      undefined,
      validLastAction
    )
    // Type-level check — if this compiles, the type is correct
    expect(typeof result === 'string' || result === null).toBe(true)
  })
})
