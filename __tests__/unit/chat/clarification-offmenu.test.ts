/**
 * Unit tests for clarification-offmenu.ts
 * Tests hesitation detection, repair phrases, and escalation messaging
 */

import {
  isHesitationPhrase,
  isRepairPhrase,
  isExitPhrase,
  getEscalationMessage,
  getHesitationPrompt,
} from '@/lib/chat/clarification-offmenu'

// =============================================================================
// isHesitationPhrase tests
// =============================================================================

describe('isHesitationPhrase', () => {
  describe('detects exact hesitation phrases', () => {
    test('recognizes "hmm" variations', () => {
      expect(isHesitationPhrase('hmm')).toBe(true)
      expect(isHesitationPhrase('hmmm')).toBe(true)
      expect(isHesitationPhrase('hmmmm')).toBe(true)
      expect(isHesitationPhrase('hm')).toBe(true)
      expect(isHesitationPhrase('hmn')).toBe(true)
      expect(isHesitationPhrase('HMM')).toBe(true) // case insensitive
    })

    test('recognizes "umm" variations', () => {
      expect(isHesitationPhrase('um')).toBe(true)
      expect(isHesitationPhrase('umm')).toBe(true)
      expect(isHesitationPhrase('ummm')).toBe(true)
      expect(isHesitationPhrase('uh')).toBe(true)
      expect(isHesitationPhrase('uhh')).toBe(true)
    })

    test('recognizes "idk" and variations', () => {
      expect(isHesitationPhrase('idk')).toBe(true)
      expect(isHesitationPhrase('IDK')).toBe(true)
      expect(isHesitationPhrase('dunno')).toBe(true)
      expect(isHesitationPhrase('i dunno')).toBe(true)
      expect(isHesitationPhrase('i donno')).toBe(true)
    })

    test('recognizes "not sure" variations', () => {
      expect(isHesitationPhrase('not sure')).toBe(true)
      expect(isHesitationPhrase("i'm not sure")).toBe(true)
      expect(isHesitationPhrase('im not sure')).toBe(true)
    })

    test('recognizes "i don\'t know" variations', () => {
      expect(isHesitationPhrase("i don't know")).toBe(true)
      expect(isHesitationPhrase('i dont know')).toBe(true)
      expect(isHesitationPhrase("don't know")).toBe(true)
      expect(isHesitationPhrase('dont know')).toBe(true)
    })

    test('recognizes other hesitation phrases', () => {
      expect(isHesitationPhrase('no idea')).toBe(true)
      expect(isHesitationPhrase('unsure')).toBe(true)
      expect(isHesitationPhrase('maybe')).toBe(true)
      expect(isHesitationPhrase('perhaps')).toBe(true)
      expect(isHesitationPhrase('let me think')).toBe(true)
    })
  })

  describe('does NOT match non-hesitation input', () => {
    test('rejects selection phrases', () => {
      expect(isHesitationPhrase('first')).toBe(false)
      expect(isHesitationPhrase('the first option')).toBe(false)
      expect(isHesitationPhrase('option 1')).toBe(false)
    })

    test('rejects exit phrases', () => {
      expect(isHesitationPhrase('cancel')).toBe(false)
      expect(isHesitationPhrase('never mind')).toBe(false)
      expect(isHesitationPhrase('stop')).toBe(false)
    })

    test('rejects regular commands', () => {
      expect(isHesitationPhrase('open links panel')).toBe(false)
      expect(isHesitationPhrase('settings')).toBe(false)
      expect(isHesitationPhrase('panel d')).toBe(false)
    })

    test('rejects random text', () => {
      expect(isHesitationPhrase('sdk')).toBe(false)
      expect(isHesitationPhrase('asdf')).toBe(false)
      expect(isHesitationPhrase('hello')).toBe(false)
    })
  })
})

// =============================================================================
// isRepairPhrase tests
// =============================================================================

describe('isRepairPhrase', () => {
  describe('detects repair phrases', () => {
    test('recognizes "not that" variations', () => {
      expect(isRepairPhrase('not that')).toBe(true)
      expect(isRepairPhrase('not that one')).toBe(true)
      expect(isRepairPhrase('not this one')).toBe(true)
      expect(isRepairPhrase('NOT THAT')).toBe(true) // case insensitive
    })

    test('recognizes "the other one" variations', () => {
      expect(isRepairPhrase('the other one')).toBe(true)
      expect(isRepairPhrase('the other')).toBe(true)
      expect(isRepairPhrase('other one')).toBe(true)
    })

    test('recognizes "no the other" variations', () => {
      expect(isRepairPhrase('no the other')).toBe(true)
      expect(isRepairPhrase('no, the other')).toBe(true)
      expect(isRepairPhrase('no the other one')).toBe(true)
    })

    test('recognizes "wrong" variations', () => {
      expect(isRepairPhrase('wrong one')).toBe(true)
      expect(isRepairPhrase('wrong')).toBe(true)
      expect(isRepairPhrase('different one')).toBe(true)
    })

    test('recognizes combined phrases', () => {
      expect(isRepairPhrase('no not that')).toBe(true)
      expect(isRepairPhrase('no, not that')).toBe(true)
      expect(isRepairPhrase('nope the other')).toBe(true)
      expect(isRepairPhrase('nah the other')).toBe(true)
    })
  })

  describe('does NOT match non-repair input', () => {
    test('rejects simple "no"', () => {
      // Simple "no" is handled separately, not as repair
      expect(isRepairPhrase('no')).toBe(false)
      expect(isRepairPhrase('nope')).toBe(false)
    })

    test('rejects hesitation phrases', () => {
      expect(isRepairPhrase('hmm')).toBe(false)
      expect(isRepairPhrase('idk')).toBe(false)
    })

    test('rejects selection phrases', () => {
      expect(isRepairPhrase('the first one')).toBe(false)
      expect(isRepairPhrase('option 2')).toBe(false)
    })
  })
})

// =============================================================================
// isExitPhrase tests
// =============================================================================

describe('isExitPhrase', () => {
  test('recognizes exit phrases', () => {
    expect(isExitPhrase('cancel')).toBe(true)
    expect(isExitPhrase('never mind')).toBe(true)
    expect(isExitPhrase('nevermind')).toBe(true)
    expect(isExitPhrase('none')).toBe(true)
    expect(isExitPhrase('stop')).toBe(true)
    expect(isExitPhrase('forget it')).toBe(true)
    expect(isExitPhrase('none of these')).toBe(true)
    expect(isExitPhrase('start over')).toBe(true)
    expect(isExitPhrase('exit')).toBe(true)
    expect(isExitPhrase('quit')).toBe(true)
    expect(isExitPhrase('no thanks')).toBe(true)
    expect(isExitPhrase('skip')).toBe(true)
    expect(isExitPhrase('something else')).toBe(true)
  })

  test('does NOT recognize simple "no" as exit', () => {
    // "no" by itself is NOT an exit phrase (it's a rejection/repair)
    expect(isExitPhrase('no')).toBe(false)
    expect(isExitPhrase('nope')).toBe(false)
    expect(isExitPhrase('nah')).toBe(false)
  })

  test('does NOT recognize repair phrases as exit', () => {
    expect(isExitPhrase('not that')).toBe(false)
    expect(isExitPhrase('the other one')).toBe(false)
  })
})

// =============================================================================
// getEscalationMessage tests
// =============================================================================

describe('getEscalationMessage', () => {
  test('attempt 1: gentle redirect, no exits', () => {
    const result = getEscalationMessage(1)
    expect(result.content).toBe('Please choose one of the options:')
    expect(result.showExits).toBe(false)
  })

  test('attempt 2: clarifying question WITH exits (per updated plan)', () => {
    const result = getEscalationMessage(2)
    expect(result.content).toBe('Which one is closer to what you need?')
    expect(result.showExits).toBe(true) // Changed from false to true per plan
  })

  test('attempt 3+: full escalation with exits', () => {
    const result = getEscalationMessage(3)
    expect(result.content).toContain('3-6 words')
    expect(result.showExits).toBe(true)

    const result4 = getEscalationMessage(4)
    expect(result4.showExits).toBe(true)
  })
})

// =============================================================================
// getHesitationPrompt tests
// =============================================================================

describe('getHesitationPrompt', () => {
  test('returns a non-empty string', () => {
    const prompt = getHesitationPrompt()
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  test('returns one of the defined prompts', () => {
    const validPrompts = [
      'Take your time. Which one sounds closer to what you need?',
      'No rush — which one fits better?',
      "That's okay. Here are your options again:",
    ]

    // Run multiple times to check randomness
    for (let i = 0; i < 10; i++) {
      const prompt = getHesitationPrompt()
      expect(validPrompts).toContain(prompt)
    }
  })
})
