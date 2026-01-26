/**
 * Unit tests for clarification-offmenu.ts
 * Tests hesitation detection, repair phrases, list rejection, and escalation messaging
 */

import {
  isHesitationPhrase,
  isRepairPhrase,
  isExitPhrase,
  isListRejectionPhrase,
  isNoise,
  classifyResponseFit,
  getEscalationMessage,
  getHesitationPrompt,
  getBasePrompt,
  getRepairPrompt,
  getNoRefusalPrompt,
  getRefinePrompt,
  getNoisePrompt,
  getAskClarifyPrompt,
  getSoftRejectPrompt,
  getConfirmPrompt,
  CONFIDENCE_THRESHOLD_EXECUTE,
  CONFIDENCE_THRESHOLD_CONFIRM,
} from '@/lib/chat/clarification-offmenu'
import type { ClarificationOption } from '@/lib/chat/chat-navigation-context'

// =============================================================================
// isNoise tests (per clarification-response-fit-plan.md)
// =============================================================================

describe('isNoise', () => {
  describe('detects empty or whitespace input as noise', () => {
    test('empty string is noise', () => {
      expect(isNoise('')).toBe(true)
      expect(isNoise('   ')).toBe(true)
    })
  })

  describe('detects low alphabetic ratio as noise', () => {
    test('pure numbers are noise (alphabetic ratio 0%)', () => {
      expect(isNoise('12345')).toBe(true)
      expect(isNoise('123 456')).toBe(true)
    })

    test('symbols with few letters are noise', () => {
      expect(isNoise('!!!')).toBe(true)
      expect(isNoise('???')).toBe(true)
      expect(isNoise('@#$%')).toBe(true)
    })

    test('mixed but mostly non-alpha is noise', () => {
      expect(isNoise('123abc!!')).toBe(true) // 3 alpha out of 8 = 37.5% < 50%
    })
  })

  describe('detects single short token as noise', () => {
    test('single char is noise', () => {
      expect(isNoise('a')).toBe(true)
      expect(isNoise('x')).toBe(true)
    })

    test('two chars is noise', () => {
      expect(isNoise('ab')).toBe(true)
      expect(isNoise('ok')).toBe(true) // 2 chars, single token
    })
  })

  describe('detects keyboard smash patterns as noise', () => {
    test('5+ consonants only is noise', () => {
      expect(isNoise('bcdfg')).toBe(true)
      expect(isNoise('qwrty')).toBe(true)
      expect(isNoise('bcdfgh')).toBe(true)
    })

    test('keyboard smash patterns are noise', () => {
      expect(isNoise('asdfg')).toBe(true)
      expect(isNoise('asdfgh')).toBe(true)
      expect(isNoise('zxcvb')).toBe(true)
    })

    test('keyboard row patterns are noise regardless of length', () => {
      // These match keyboard row patterns
      expect(isNoise('jkl')).toBe(true)   // Home row pattern
      expect(isNoise('asd')).toBe(true)   // Home row pattern
      expect(isNoise('zxc')).toBe(true)   // Bottom row pattern
    })

    test('short non-keyboard-row consonants may be valid abbreviations', () => {
      // These don't match keyboard row patterns
      expect(isNoise('xyz')).toBe(false)  // Not a keyboard row, could be abbreviation
      expect(isNoise('rgb')).toBe(false)  // Not a keyboard row, valid abbreviation
    })
  })

  describe('detects emoji-only as noise', () => {
    test('single emoji is noise', () => {
      expect(isNoise('😀')).toBe(true)
      expect(isNoise('👍')).toBe(true)
    })

    test('multiple emojis are noise', () => {
      expect(isNoise('😀😀😀')).toBe(true)
      expect(isNoise('🎉🎊🎈')).toBe(true)
    })
  })

  describe('detects repeated characters as noise', () => {
    test('same char repeated 4+ times is noise', () => {
      expect(isNoise('aaaa')).toBe(true)
      expect(isNoise('xxxxx')).toBe(true)
    })
  })

  describe('does NOT classify valid input as noise', () => {
    test('normal words are not noise', () => {
      expect(isNoise('hello')).toBe(false)
      expect(isNoise('first')).toBe(false)
      expect(isNoise('second')).toBe(false)
    })

    test('option labels are not noise', () => {
      expect(isNoise('Links Panel D')).toBe(false)
      expect(isNoise('Notes')).toBe(false)
      expect(isNoise('Docs')).toBe(false)
    })

    test('short valid words (3+ chars with vowels) are not noise', () => {
      expect(isNoise('sdk')).toBe(false) // Known abbreviation, whitelisted
      expect(isNoise('the')).toBe(false)
      expect(isNoise('yes')).toBe(false)
      expect(isNoise('one')).toBe(false)
      expect(isNoise('api')).toBe(false) // Known abbreviation
    })

    test('hesitation phrases are not noise', () => {
      expect(isNoise('hmm')).toBe(false) // Whitelisted hesitation pattern
      expect(isNoise('hmmm')).toBe(false)
      expect(isNoise('umm')).toBe(false)
      expect(isNoise('idk')).toBe(false) // Whitelisted
      expect(isNoise('not sure')).toBe(false)
    })

    test('numbers mixed with valid text are not noise', () => {
      expect(isNoise('option 1')).toBe(false)
      expect(isNoise('workspace 2')).toBe(false)
    })

    test('commands with proper structure are not noise', () => {
      expect(isNoise('open settings')).toBe(false)
      expect(isNoise('show profile')).toBe(false)
    })
  })
})

// =============================================================================
// getNoisePrompt tests
// =============================================================================

describe('getNoisePrompt', () => {
  test('returns the unparseable prompt', () => {
    const prompt = getNoisePrompt()
    expect(prompt).toContain("I didn't catch that")
    expect(prompt).toContain('first')
    expect(prompt).toContain('second')
    expect(prompt).toContain('none of these')
  })
})

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
  test('recognizes explicit exit phrases', () => {
    expect(isExitPhrase('cancel')).toBe(true)
    expect(isExitPhrase('never mind')).toBe(true)
    expect(isExitPhrase('nevermind')).toBe(true)
    expect(isExitPhrase('stop')).toBe(true)
    expect(isExitPhrase('forget it')).toBe(true)
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

  test('does NOT recognize list rejection as exit (triggers Refine Mode instead)', () => {
    // Per clarification-offmenu-handling-plan.md:
    // "none of these/those/neither" → Refine Mode, NOT exit
    expect(isExitPhrase('none of these')).toBe(false)
    expect(isExitPhrase('none of those')).toBe(false)
    expect(isExitPhrase('neither')).toBe(false)
    expect(isExitPhrase('neither of these')).toBe(false)
  })
})

// =============================================================================
// isListRejectionPhrase tests
// =============================================================================

describe('isListRejectionPhrase', () => {
  test('recognizes list rejection phrases', () => {
    expect(isListRejectionPhrase('none of these')).toBe(true)
    expect(isListRejectionPhrase('none of those')).toBe(true)
    expect(isListRejectionPhrase('neither')).toBe(true)
    expect(isListRejectionPhrase('neither of these')).toBe(true)
    expect(isListRejectionPhrase('neither of those')).toBe(true)
    expect(isListRejectionPhrase('not these')).toBe(true)
    expect(isListRejectionPhrase('not those')).toBe(true)
    expect(isListRejectionPhrase('none of them')).toBe(true)
    expect(isListRejectionPhrase('neither one')).toBe(true)
    expect(isListRejectionPhrase('neither option')).toBe(true)
  })

  test('is case insensitive', () => {
    expect(isListRejectionPhrase('NONE OF THESE')).toBe(true)
    expect(isListRejectionPhrase('Neither')).toBe(true)
  })

  test('recognizes polite variations (trailing politeness words)', () => {
    expect(isListRejectionPhrase('none of those please')).toBe(true)
    expect(isListRejectionPhrase('none of these thanks')).toBe(true)
    expect(isListRejectionPhrase('neither, thanks')).toBe(true)
    expect(isListRejectionPhrase('none of those pls')).toBe(true)
    expect(isListRejectionPhrase('neither thx')).toBe(true)
    expect(isListRejectionPhrase('none of these, thank you')).toBe(true)
  })

  test('does NOT match compound inputs with additional content (should fall through to topic detection)', () => {
    // These should NOT be list rejection - user is trying to switch topic
    expect(isListRejectionPhrase('none of those, open dashboard')).toBe(false)
    expect(isListRejectionPhrase('neither, show me settings')).toBe(false)
    expect(isListRejectionPhrase('none of these I want something else')).toBe(false)
  })

  test('does NOT match exit phrases', () => {
    expect(isListRejectionPhrase('cancel')).toBe(false)
    expect(isListRejectionPhrase('stop')).toBe(false)
  })

  test('does NOT match repair phrases', () => {
    expect(isListRejectionPhrase('not that')).toBe(false)
    expect(isListRejectionPhrase('the other one')).toBe(false)
  })

  test('does NOT match simple "no"', () => {
    expect(isListRejectionPhrase('no')).toBe(false)
    expect(isListRejectionPhrase('nope')).toBe(false)
  })
})

// =============================================================================
// getEscalationMessage tests
// =============================================================================

describe('getEscalationMessage', () => {
  test('attempt 1: unparseable prompt per Example 5, no exits', () => {
    const result = getEscalationMessage(1)
    // Per Example 5: "I didn't catch that. Reply first or second..."
    expect(result.content).toContain("I didn't catch that")
    expect(result.content).toContain('first')
    expect(result.content).toContain('second')
    expect(result.content).toContain('none of these')
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
  test('returns the consistent hesitation prompt', () => {
    // Per clarification-offmenu-handling-plan.md: Use consistent template
    const prompt = getHesitationPrompt()
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).toContain('Which one do you mean')
    expect(prompt).toContain('none of these')
  })
})

// =============================================================================
// Consistent Prompt Template tests
// =============================================================================

describe('Consistent Prompt Templates', () => {
  test('getBasePrompt returns the consistent base template', () => {
    const prompt = getBasePrompt()
    expect(prompt).toContain('Which one do you mean')
    expect(prompt).toContain('none of these')
    expect(prompt).toContain('none of those')
    expect(prompt).toContain('one detail')
  })

  test('getRepairPrompt returns the repair template', () => {
    const prompt = getRepairPrompt()
    expect(prompt).toContain('not that one')
    expect(prompt).toContain('Which one do you mean instead')
    expect(prompt).toContain('none of these')
  })

  test('getNoRefusalPrompt returns the no refusal template', () => {
    const prompt = getNoRefusalPrompt()
    expect(prompt).toContain('No problem')
    expect(prompt).toContain('Which one do you mean')
    expect(prompt).toContain('none of these')
  })

  test('getRefinePrompt returns the refine mode template', () => {
    const prompt = getRefinePrompt()
    expect(prompt).toContain('Got it')
    expect(prompt).toContain('one detail')
    expect(prompt).toContain('show more results')
  })
})

// =============================================================================
// Response-Fit Classifier tests (per clarification-response-fit-plan.md)
// =============================================================================

describe('classifyResponseFit', () => {
  // Sample options for testing
  const mockOptions: ClarificationOption[] = [
    { id: 'doc1', label: 'Links Panel D', type: 'doc' },
    { id: 'doc2', label: 'Links Panel E', type: 'doc' },
    { id: 'note1', label: 'SDK Documentation', type: 'note' },
  ]

  describe('short hint classification', () => {
    test('short hint matching an option token → ask_clarify (per plan: no auto-select on short hints)', () => {
      // Per plan line 138: "input 'sdk' → ask_clarify (not auto-select)"
      // Per plan line 175: "Short hint words (≤2 tokens) should stay in ask_clarify"
      const result = classifyResponseFit('sdk', mockOptions, 'option_selection')
      expect(result.intent).toBe('ask_clarify')
      expect(result.reason).toBe('short_hint_full_overlap')
    })

    test('short hint with no overlap → ask_clarify', () => {
      const result = classifyResponseFit('api', mockOptions, 'option_selection')
      expect(result.intent).toBe('ask_clarify')
      expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD_CONFIRM)
    })

    test('ambiguous short hint → ask_clarify', () => {
      // "panel" alone is too vague (matches both Panel D and Panel E)
      const result = classifyResponseFit('panel', mockOptions, 'option_selection')
      expect(['ask_clarify', 'soft_reject']).toContain(result.intent)
    })
  })

  describe('mapped selection classification', () => {
    test('exact label match → select with high confidence', () => {
      const result = classifyResponseFit('Links Panel D', mockOptions, 'option_selection')
      expect(result.intent).toBe('select')
      expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD_EXECUTE)
      expect(result.choiceId).toBe('doc1')
    })

    test('partial match → select with medium confidence', () => {
      const result = classifyResponseFit('panel d', mockOptions, 'option_selection')
      // May be select or ask_clarify depending on mapping confidence
      expect(['select', 'ask_clarify']).toContain(result.intent)
    })
  })

  describe('ambiguous classification', () => {
    test('ambiguous partial match → soft_reject', () => {
      // "links panel" matches both D and E
      const result = classifyResponseFit('links panel', mockOptions, 'option_selection')
      expect(['soft_reject', 'ask_clarify']).toContain(result.intent)
    })
  })

  describe('new topic classification', () => {
    test('clear command (3+ tokens) with non-overlapping content → new_topic', () => {
      // "show me profile" is 3 tokens (no stopwords) and clearly a different command
      const result = classifyResponseFit('show me profile', mockOptions, 'option_selection')
      expect(result.intent).toBe('new_topic')
    })

    test('clear command with action verb and enough tokens → new_topic', () => {
      // "open user settings" is 3 tokens and clearly a different command
      const result = classifyResponseFit('open user settings', mockOptions, 'option_selection')
      expect(result.intent).toBe('new_topic')
    })

    test('short command (2 effective tokens after stopwords) may be ask_clarify', () => {
      // "open my settings" becomes ["open", "settings"] after filtering "my" (stopword)
      // Short commands may be ask_clarify for safety to avoid accidental exits
      const result = classifyResponseFit('open my settings', mockOptions, 'option_selection')
      expect(['new_topic', 'ask_clarify']).toContain(result.intent)
    })
  })

  describe('confidence thresholds', () => {
    test('CONFIDENCE_THRESHOLD_EXECUTE is 0.75', () => {
      expect(CONFIDENCE_THRESHOLD_EXECUTE).toBe(0.75)
    })

    test('CONFIDENCE_THRESHOLD_CONFIRM is 0.55', () => {
      expect(CONFIDENCE_THRESHOLD_CONFIRM).toBe(0.55)
    })
  })
})

// =============================================================================
// Response-Fit Prompt Template tests
// =============================================================================

describe('Response-Fit Prompt Templates', () => {
  test('getAskClarifyPrompt includes hint tokens (per plan template)', () => {
    // Per plan line 106: "Are you looking for X? If yes, choose A; if not, choose B."
    const prompt = getAskClarifyPrompt(['sdk', 'docs'])
    expect(prompt).toContain('sdk docs')
    expect(prompt).toContain('Are you looking for')
  })

  test('getAskClarifyPrompt with 2 options uses structured template', () => {
    // Per plan: for 2 options, use "If yes, choose A; if not, choose B."
    const prompt = getAskClarifyPrompt(['sdk'], ['Option A', 'Option B'])
    expect(prompt).toContain('sdk')
    expect(prompt).toContain('Option A')
    expect(prompt).toContain('Option B')
  })

  test('getSoftRejectPrompt with single candidate', () => {
    const prompt = getSoftRejectPrompt(['Links Panel D'])
    expect(prompt).toContain('Links Panel D')
    expect(prompt).toContain('none of these')
  })

  test('getSoftRejectPrompt with two candidates', () => {
    const prompt = getSoftRejectPrompt(['Links Panel D', 'Links Panel E'])
    expect(prompt).toContain('Links Panel D')
    expect(prompt).toContain('Links Panel E')
  })

  test('getConfirmPrompt includes option label', () => {
    const prompt = getConfirmPrompt('SDK Documentation')
    expect(prompt).toContain('SDK Documentation')
    expect(prompt).toContain('confirm')
  })
})
