import { detectLocalSemanticIntent } from '@/lib/chat/input-classifiers'

describe('detectLocalSemanticIntent', () => {
  // === Positive matches (exact patterns only) ===

  it('matches "what did I do before that?" → explain_last_action', () => {
    expect(detectLocalSemanticIntent('what did I do before that?')).toBe('explain_last_action')
  })

  it('matches "what did I do before that" (no question mark) → explain_last_action', () => {
    expect(detectLocalSemanticIntent('what did I do before that')).toBe('explain_last_action')
  })

  it('matches "what did I just do?" → last_action', () => {
    expect(detectLocalSemanticIntent('what did I just do?')).toBe('last_action')
  })

  it('matches "what did I do?" → last_action', () => {
    expect(detectLocalSemanticIntent('what did I do?')).toBe('last_action')
  })

  it('matches "what was my last action?" → last_action', () => {
    expect(detectLocalSemanticIntent('what was my last action?')).toBe('last_action')
  })

  it('is case-insensitive', () => {
    expect(detectLocalSemanticIntent('What Did I Do Before That?')).toBe('explain_last_action')
    expect(detectLocalSemanticIntent('WHAT DID I JUST DO?')).toBe('last_action')
  })

  it('trims whitespace', () => {
    expect(detectLocalSemanticIntent('  what did I do before that?  ')).toBe('explain_last_action')
  })

  // === Negative matches (must return null) ===

  it('rejects commands → null', () => {
    expect(detectLocalSemanticIntent('open panel e')).toBeNull()
  })

  it('rejects ordinal selections → null', () => {
    expect(detectLocalSemanticIntent('2')).toBeNull()
  })

  it('rejects non-matching queries → null', () => {
    expect(detectLocalSemanticIntent('tell me about the links panel')).toBeNull()
  })

  it('rejects compound queries → null', () => {
    expect(detectLocalSemanticIntent('what did I do before that and open panel e')).toBeNull()
  })

  it('rejects summarize variants (not in narrow set) → null', () => {
    expect(detectLocalSemanticIntent('summarize my activity')).toBeNull()
  })

  it('rejects "what happened?" (too broad) → null', () => {
    expect(detectLocalSemanticIntent('what happened?')).toBeNull()
  })

  it('rejects "explain what just happened" (not exact match) → null', () => {
    expect(detectLocalSemanticIntent('explain what just happened')).toBeNull()
  })

  it('rejects option-related words → null', () => {
    expect(detectLocalSemanticIntent('what was my first option')).toBeNull()
    expect(detectLocalSemanticIntent('show me the bottom choice')).toBeNull()
  })

  it('rejects empty/whitespace input → null', () => {
    expect(detectLocalSemanticIntent('')).toBeNull()
    expect(detectLocalSemanticIntent('   ')).toBeNull()
  })

  // === Filler stripping (conversational prefix/suffix) ===

  it('strips "assistant" prefix → explain_last_action', () => {
    expect(detectLocalSemanticIntent('assistant what did I do before that?')).toBe('explain_last_action')
  })

  it('strips "assistant" + "thank you" suffix → explain_last_action', () => {
    expect(detectLocalSemanticIntent('assistant explain what did I do before that? thank you')).toBe('explain_last_action')
  })

  it('strips "hey" prefix + "thanks" suffix → last_action', () => {
    expect(detectLocalSemanticIntent('hey what did I just do? thanks')).toBe('last_action')
  })

  it('strips "please" prefix + "thank you" suffix → last_action', () => {
    expect(detectLocalSemanticIntent('please what was my last action? thank you')).toBe('last_action')
  })

  it('matches "explain what did I do before that?" → explain_last_action', () => {
    expect(detectLocalSemanticIntent('explain what did I do before that?')).toBe('explain_last_action')
  })

  it('filler stripping does not break non-semantic queries → null', () => {
    expect(detectLocalSemanticIntent('open panel e please')).toBeNull()
  })

  it('compound guard still rejects on original input (filler does not bypass) → null', () => {
    expect(detectLocalSemanticIntent('assistant and then what did I do')).toBeNull()
  })

  it('strips "ok" prefix → last_action', () => {
    expect(detectLocalSemanticIntent('ok what did I do?')).toBe('last_action')
  })

  it('strips "um" prefix → explain_last_action', () => {
    expect(detectLocalSemanticIntent('um what did I do before that?')).toBe('explain_last_action')
  })

  it('strips suffix with punctuation → last_action', () => {
    expect(detectLocalSemanticIntent('what did I just do? thx!')).toBe('last_action')
  })
})
