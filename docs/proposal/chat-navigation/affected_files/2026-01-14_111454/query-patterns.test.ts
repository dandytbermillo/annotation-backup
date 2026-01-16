/**
 * Query Patterns Test Suite
 * Part of: TD-3 (Consolidate Pattern Matching)
 *
 * Regression test table for common phrases to ensure routing behavior is stable.
 * Run with: npm test -- query-patterns
 */

import {
  // Pattern constants
  AFFIRMATION_PATTERN,
  REJECTION_PATTERN,
  QUESTION_START_PATTERN,
  COMMAND_START_PATTERN,
  ACTION_NOUNS,
  DOC_VERBS,
  // Normalization functions
  normalizeInputForRouting,
  stripConversationalPrefix,
  normalizeTypos,
  normalizeTitle,
  // Detection functions
  isAffirmationPhrase,
  isRejectionPhrase,
  isCorrectionPhrase,
  isPronounFollowUp,
  hasQuestionIntent,
  hasActionVerb,
  containsDocInstructionCue,
  looksIndexLikeReference,
  isMetaPhrase,
  matchesReshowPhrases,
  isMetaExplainOutsideClarification,
  isCommandLike,
  isNewQuestionOrCommand,
  // Extraction functions
  extractMetaExplainConcept,
  extractDocQueryTerm,
  // Response style
  getResponseStyle,
  // Main API
  classifyQueryIntent,
  normalizeQuery,
  // TD-2: Fuzzy matching
  findFuzzyMatch,
  findAllFuzzyMatches,
  hasFuzzyMatch,
} from '@/lib/chat/query-patterns'

describe('Query Patterns Module', () => {
  // ==========================================================================
  // Regression Table (per TD-3 plan)
  // ==========================================================================

  describe('Regression Table - Intent Classification', () => {
    const testCases: Array<{ input: string; expectedIntent: string }> = [
      // Explain patterns
      { input: 'what is workspace', expectedIntent: 'explain' },
      { input: 'what are actions', expectedIntent: 'explain' },
      { input: 'can you tell me what are actions', expectedIntent: 'explain' },
      { input: 'explain home', expectedIntent: 'explain' },
      // Note: "what is that" is treated as meta because it's a bare clarification phrase
      { input: 'what is that', expectedIntent: 'meta' },

      // Action patterns
      { input: 'open notes', expectedIntent: 'action' },
      { input: 'show me recent', expectedIntent: 'action' },
      // Note: "go home" has action verb so isCommandLike returns true before navigate check
      // Pure navigate patterns: back, home (without verb prefix)
      { input: 'back', expectedIntent: 'navigate' },
      { input: 'home', expectedIntent: 'navigate' },
      { input: 'workspace 6', expectedIntent: 'action' },
      { input: 'note 2', expectedIntent: 'action' },

      // Follow-up patterns
      { input: 'tell me more', expectedIntent: 'followup' },
      { input: 'more details', expectedIntent: 'followup' },
      { input: 'how does it work', expectedIntent: 'followup' },
      { input: 'continue', expectedIntent: 'followup' },
      { input: 'elaborate', expectedIntent: 'followup' },

      // Correction patterns (Note: "no", "not that", "wrong" are also rejection phrases,
      // but rejection is checked first so they return 'rejection'. Use 'try again' for correction.)
      { input: 'try again', expectedIntent: 'correction' },
      { input: 'not what i meant', expectedIntent: 'correction' },
      { input: 'something else', expectedIntent: 'correction' },

      // Affirmation patterns
      { input: 'yes', expectedIntent: 'affirmation' },
      { input: 'ok', expectedIntent: 'affirmation' },
      { input: 'sure', expectedIntent: 'affirmation' },
      { input: 'go ahead', expectedIntent: 'affirmation' },

      // Rejection patterns
      { input: 'cancel', expectedIntent: 'rejection' },
      { input: 'stop', expectedIntent: 'rejection' },
      { input: 'never mind', expectedIntent: 'rejection' },

      // Meta patterns (clarification requests)
      { input: 'what do you mean?', expectedIntent: 'meta' },
      { input: 'huh?', expectedIntent: 'meta' },
      { input: '?', expectedIntent: 'meta' },
      { input: 'options?', expectedIntent: 'meta' },

      // Unknown
      { input: 'hello', expectedIntent: 'unknown' },
      { input: 'thanks', expectedIntent: 'unknown' },
    ]

    test.each(testCases)('classifyQueryIntent("$input") → $expectedIntent', ({ input, expectedIntent }) => {
      const result = classifyQueryIntent(input)
      expect(result).toBe(expectedIntent)
    })
  })

  // ==========================================================================
  // Pattern Constants
  // ==========================================================================

  describe('AFFIRMATION_PATTERN', () => {
    const positives = ['yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'yes please', 'go ahead']
    const negatives = ['yes but', 'okay then', 'yes I want to', 'sure thing']

    test.each(positives)('matches "%s"', (input) => {
      expect(AFFIRMATION_PATTERN.test(input.toLowerCase())).toBe(true)
    })

    test.each(negatives)('does NOT match "%s"', (input) => {
      expect(AFFIRMATION_PATTERN.test(input.toLowerCase())).toBe(false)
    })
  })

  describe('REJECTION_PATTERN', () => {
    const positives = ['no', 'nope', 'cancel', 'stop', 'not now', 'skip']
    const negatives = ['no way', 'cancel that please', 'stop it']

    test.each(positives)('matches "%s"', (input) => {
      expect(REJECTION_PATTERN.test(input.toLowerCase())).toBe(true)
    })

    test.each(negatives)('does NOT match "%s"', (input) => {
      expect(REJECTION_PATTERN.test(input.toLowerCase())).toBe(false)
    })
  })

  describe('QUESTION_START_PATTERN', () => {
    const positives = ['what is', 'how do', 'where can', 'when will', 'is this']
    const negatives = ['open this', 'show me', 'the what']

    test.each(positives)('matches "%s"', (input) => {
      expect(QUESTION_START_PATTERN.test(input)).toBe(true)
    })

    test.each(negatives)('does NOT match "%s"', (input) => {
      expect(QUESTION_START_PATTERN.test(input)).toBe(false)
    })
  })

  describe('COMMAND_START_PATTERN', () => {
    const positives = ['open notes', 'show me', 'go home', 'create new', 'delete this']
    const negatives = ['what is open', 'how to show', 'I want to go']

    test.each(positives)('matches "%s"', (input) => {
      expect(COMMAND_START_PATTERN.test(input)).toBe(true)
    })

    test.each(negatives)('does NOT match "%s"', (input) => {
      expect(COMMAND_START_PATTERN.test(input)).toBe(false)
    })
  })

  // ==========================================================================
  // Normalization Functions
  // ==========================================================================

  describe('normalizeInputForRouting', () => {
    test('lowercases and trims', () => {
      const result = normalizeInputForRouting('  HELLO World  ')
      expect(result.normalized).toBe('hello world')
      expect(result.tokens).toEqual(['hello', 'world'])
    })

    test('replaces separators with space', () => {
      const result = normalizeInputForRouting('note-taking/management')
      expect(result.normalized).toBe('note taking management')
    })

    test('removes trailing punctuation', () => {
      const result = normalizeInputForRouting('what is workspace?')
      expect(result.normalized).toBe('what is workspace')
    })

    test('collapses multiple spaces', () => {
      const result = normalizeInputForRouting('hello   world')
      expect(result.normalized).toBe('hello world')
    })
  })

  describe('stripConversationalPrefix', () => {
    test('strips "can you tell me"', () => {
      expect(stripConversationalPrefix('can you tell me what is workspace')).toBe('what is workspace')
    })

    test('strips "please tell me"', () => {
      expect(stripConversationalPrefix('please tell me what is workspace')).toBe('what is workspace')
    })

    test('strips "could you explain"', () => {
      expect(stripConversationalPrefix('could you explain what is home')).toBe('what is home')
    })

    test('keeps non-prefixed input', () => {
      expect(stripConversationalPrefix('what is workspace')).toBe('what is workspace')
    })
  })

  describe('normalizeTypos', () => {
    test('fixes "shwo" → "show"', () => {
      expect(normalizeTypos('shwo me options')).toBe('show me options')
    })

    test('fixes "optins" → "options"', () => {
      expect(normalizeTypos('show me optins')).toBe('show me options')
    })

    test('fixes "teh" → "the"', () => {
      expect(normalizeTypos('what is teh difference')).toBe('what is the difference')
    })
  })

  describe('normalizeTitle', () => {
    test('lowercases and normalizes', () => {
      expect(normalizeTitle('Recent Notes')).toBe('recent notes')
    })

    test('replaces separators', () => {
      expect(normalizeTitle('Quick-Links')).toBe('quick links')
    })
  })

  // ==========================================================================
  // Detection Functions
  // ==========================================================================

  describe('isAffirmationPhrase', () => {
    test.each(['yes', 'yeah', 'ok', 'sure', 'yes please'])('returns true for "%s"', (input) => {
      expect(isAffirmationPhrase(input)).toBe(true)
    })

    test.each(['hello', 'no', 'maybe'])('returns false for "%s"', (input) => {
      expect(isAffirmationPhrase(input)).toBe(false)
    })
  })

  describe('isRejectionPhrase', () => {
    test.each(['no', 'nope', 'cancel', 'stop'])('returns true for "%s"', (input) => {
      expect(isRejectionPhrase(input)).toBe(true)
    })

    test.each(['hello', 'yes', 'maybe'])('returns false for "%s"', (input) => {
      expect(isRejectionPhrase(input)).toBe(false)
    })
  })

  describe('isCorrectionPhrase', () => {
    test.each(['no', 'not that', 'wrong', 'try again'])('returns true for "%s"', (input) => {
      expect(isCorrectionPhrase(input)).toBe(true)
    })

    test.each(['yes', 'ok', 'hello'])('returns false for "%s"', (input) => {
      expect(isCorrectionPhrase(input)).toBe(false)
    })
  })

  describe('isPronounFollowUp', () => {
    test.each(['tell me more', 'more details', 'how does it work', 'continue', 'elaborate'])(
      'returns true for "%s"',
      (input) => {
        expect(isPronounFollowUp(input)).toBe(true)
      }
    )

    test.each(['hello', 'what is workspace', 'open notes'])('returns false for "%s"', (input) => {
      expect(isPronounFollowUp(input)).toBe(false)
    })
  })

  describe('hasQuestionIntent', () => {
    test.each(['what is this', 'how do I', 'is this correct?'])('returns true for "%s"', (input) => {
      expect(hasQuestionIntent(input)).toBe(true)
    })

    test.each(['open notes', 'show me'])('returns false for "%s"', (input) => {
      expect(hasQuestionIntent(input)).toBe(false)
    })
  })

  describe('hasActionVerb', () => {
    test.each(['open notes', 'show me', 'create new', 'delete this'])('returns true for "%s"', (input) => {
      expect(hasActionVerb(input)).toBe(true)
    })

    test.each(['what is workspace', 'tell me more'])('returns false for "%s"', (input) => {
      expect(hasActionVerb(input)).toBe(false)
    })
  })

  describe('containsDocInstructionCue', () => {
    test.each(['how to add', 'how do I create', 'show me how to', 'walk me through'])(
      'returns true for "%s"',
      (input) => {
        expect(containsDocInstructionCue(input)).toBe(true)
      }
    )

    test.each(['show me recent', 'open notes'])('returns false for "%s"', (input) => {
      expect(containsDocInstructionCue(input)).toBe(false)
    })
  })

  describe('looksIndexLikeReference', () => {
    test.each(['workspace 6', 'note 2', 'page 10'])('returns true for "%s"', (input) => {
      expect(looksIndexLikeReference(input)).toBe(true)
    })

    test.each(['workspace', 'note', 'open workspace'])('returns false for "%s"', (input) => {
      expect(looksIndexLikeReference(input)).toBe(false)
    })
  })

  describe('isMetaPhrase', () => {
    test.each(['what do you mean?', 'huh?', '?', 'options?', 'clarify'])('returns true for "%s"', (input) => {
      expect(isMetaPhrase(input)).toBe(true)
    })

    test.each(['what is workspace', 'hello', 'yes'])('returns false for "%s"', (input) => {
      expect(isMetaPhrase(input)).toBe(false)
    })
  })

  describe('matchesReshowPhrases', () => {
    test.each(['show me options', 'options?', 'remind me', 'show me again'])('returns true for "%s"', (input) => {
      expect(matchesReshowPhrases(input)).toBe(true)
    })

    test.each(['hello', 'what is workspace'])('returns false for "%s"', (input) => {
      expect(matchesReshowPhrases(input)).toBe(false)
    })
  })

  describe('isMetaExplainOutsideClarification', () => {
    // Note: "tell me more" is in BARE_META_PHRASES so it returns true
    test.each(['explain', 'what is workspace', 'what are actions', 'explain home', 'what is that', 'tell me more'])(
      'returns true for "%s"',
      (input) => {
        expect(isMetaExplainOutsideClarification(input)).toBe(true)
      }
    )

    test.each(['hello', 'open notes', 'yes'])('returns false for "%s"', (input) => {
      expect(isMetaExplainOutsideClarification(input)).toBe(false)
    })
  })

  describe('isCommandLike', () => {
    test.each(['open notes', 'show me recent', 'workspace 6', 'can you open notes'])(
      'returns true for "%s"',
      (input) => {
        expect(isCommandLike(input)).toBe(true)
      }
    )

    test.each(['what is workspace', 'tell me more', 'how to add notes'])('returns false for "%s"', (input) => {
      expect(isCommandLike(input)).toBe(false)
    })
  })

  describe('isNewQuestionOrCommand', () => {
    test.each(['what is workspace', 'open notes', 'how do I', 'tell me about', 'explain this'])(
      'returns true for "%s"',
      (input) => {
        expect(isNewQuestionOrCommand(input)).toBe(true)
      }
    )

    test.each(['yes', 'ok', 'more'])('returns false for "%s"', (input) => {
      expect(isNewQuestionOrCommand(input)).toBe(false)
    })
  })

  // ==========================================================================
  // Extraction Functions
  // ==========================================================================

  describe('extractMetaExplainConcept', () => {
    test('extracts from "what is workspace"', () => {
      expect(extractMetaExplainConcept('what is workspace')).toBe('workspace')
    })

    test('extracts from "what are actions"', () => {
      expect(extractMetaExplainConcept('what are actions')).toBe('actions')
    })

    test('extracts from "explain home"', () => {
      expect(extractMetaExplainConcept('explain home')).toBe('home')
    })

    test('handles conversational prefix', () => {
      expect(extractMetaExplainConcept('can you tell me what are the actions')).toBe('actions')
    })

    test('returns null for non-meta-explain', () => {
      expect(extractMetaExplainConcept('hello world')).toBeNull()
    })
  })

  describe('extractDocQueryTerm', () => {
    test('extracts from "what is workspace"', () => {
      expect(extractDocQueryTerm('what is workspace')).toBe('workspace')
    })

    test('extracts from "how do I add widgets"', () => {
      expect(extractDocQueryTerm('how do I add widgets')).toBe('add widgets')
    })

    test('extracts from "tell me about notes"', () => {
      expect(extractDocQueryTerm('tell me about notes')).toBe('notes')
    })

    test('extracts from "walk me through creating folders"', () => {
      expect(extractDocQueryTerm('walk me through creating folders')).toBe('creating folders')
    })
  })

  // ==========================================================================
  // Response Style
  // ==========================================================================

  describe('getResponseStyle', () => {
    test('returns "detailed" for instructional queries', () => {
      expect(getResponseStyle('walk me through')).toBe('detailed')
      expect(getResponseStyle('step by step')).toBe('detailed')
      expect(getResponseStyle('how do I add')).toBe('detailed')
    })

    test('returns "medium" for explanation queries', () => {
      expect(getResponseStyle('explain workspace')).toBe('medium')
      expect(getResponseStyle('describe the feature')).toBe('medium')
      expect(getResponseStyle('tell me about notes')).toBe('medium')
    })

    test('returns "short" for simple queries', () => {
      expect(getResponseStyle('what is workspace')).toBe('short')
      expect(getResponseStyle('hello')).toBe('short')
    })
  })

  // ==========================================================================
  // Main API
  // ==========================================================================

  describe('normalizeQuery', () => {
    test('returns full analysis for "what is workspace"', () => {
      const result = normalizeQuery('what is workspace')
      expect(result.original).toBe('what is workspace')
      expect(result.normalized).toBe('what is workspace')
      expect(result.intent).toBe('explain')
      expect(result.isQuestion).toBe(true)
      expect(result.isCommand).toBe(false)
      expect(result.extractedTopic).toBe('workspace')
    })

    test('returns full analysis for "open notes"', () => {
      const result = normalizeQuery('open notes')
      expect(result.original).toBe('open notes')
      expect(result.intent).toBe('action')
      expect(result.isQuestion).toBe(false)
      expect(result.isCommand).toBe(true)
    })

    test('handles conversational prefix', () => {
      const result = normalizeQuery('can you tell me what are the actions')
      expect(result.stripped).toBe('what are the actions')
      expect(result.intent).toBe('explain')
    })
  })

  // ==========================================================================
  // TD-2: Fuzzy Matching Tests
  // ==========================================================================

  describe('findFuzzyMatch', () => {
    const knownTerms = new Set(['workspace', 'workspaces', 'dashboard', 'settings', 'annotations'])

    // Acceptance criteria from TD-2 plan
    test('workspac → workspace (missing trailing e)', () => {
      const result = findFuzzyMatch('workspac', knownTerms)
      expect(result).not.toBeNull()
      expect(result?.matchedTerm).toBe('workspace')
      expect(result?.distance).toBe(1)
    })

    test('wrkspace → workspace (missing o)', () => {
      const result = findFuzzyMatch('wrkspace', knownTerms)
      expect(result).not.toBeNull()
      expect(result?.matchedTerm).toBe('workspace')
      expect(result?.distance).toBe(1)
    })

    test('worksapce → workspace (transposition)', () => {
      const result = findFuzzyMatch('worksapce', knownTerms)
      expect(result).not.toBeNull()
      expect(result?.matchedTerm).toBe('workspace')
      expect(result?.distance).toBe(2)
    })

    test('note does NOT fuzzy-match (length 4 < min 5)', () => {
      const result = findFuzzyMatch('note', knownTerms)
      expect(result).toBeNull()
    })

    test('does NOT match if distance > 2', () => {
      // "worksp" is length 6, distance 3 to "workspace"
      const result = findFuzzyMatch('worksp', knownTerms)
      expect(result).toBeNull()
    })

    test('does NOT match if too different in length', () => {
      // "work" is length 4 < min 5
      const result = findFuzzyMatch('work', knownTerms)
      expect(result).toBeNull()
    })

    test('exact match skipped, returns closest fuzzy (workspace → workspaces)', () => {
      // When token exactly matches one term, it may still fuzzy-match a similar term
      // This is fine because exact matches are handled in routing before fuzzy
      const result = findFuzzyMatch('workspace', knownTerms)
      // workspace → workspaces is distance 1 (one char difference)
      expect(result?.matchedTerm).toBe('workspaces')
      expect(result?.distance).toBe(1)
    })

    test('dashbord → dashboard (missing a)', () => {
      const result = findFuzzyMatch('dashbord', knownTerms)
      expect(result).not.toBeNull()
      expect(result?.matchedTerm).toBe('dashboard')
      expect(result?.distance).toBe(1)
    })

    test('setings → settings (missing t)', () => {
      const result = findFuzzyMatch('setings', knownTerms)
      expect(result).not.toBeNull()
      expect(result?.matchedTerm).toBe('settings')
      expect(result?.distance).toBe(1)
    })

    test('annotaions → annotations (missing t)', () => {
      // annotaions (10 chars) vs annotations (11 chars) = distance 1
      const result = findFuzzyMatch('annotaions', knownTerms)
      expect(result).not.toBeNull()
      expect(result?.matchedTerm).toBe('annotations')
      expect(result?.distance).toBe(1)
    })
  })

  describe('findAllFuzzyMatches', () => {
    const knownTerms = new Set(['workspace', 'dashboard', 'settings'])

    test('finds multiple fuzzy matches', () => {
      const tokens = ['workspac', 'dashbord', 'hello']
      const results = findAllFuzzyMatches(tokens, knownTerms)
      expect(results).toHaveLength(2)
      expect(results.map(r => r.matchedTerm)).toContain('workspace')
      expect(results.map(r => r.matchedTerm)).toContain('dashboard')
    })

    test('returns empty array when no fuzzy matches', () => {
      const tokens = ['hello', 'world']
      const results = findAllFuzzyMatches(tokens, knownTerms)
      expect(results).toHaveLength(0)
    })

    test('skips short tokens', () => {
      const tokens = ['work', 'dash', 'set']
      const results = findAllFuzzyMatches(tokens, knownTerms)
      expect(results).toHaveLength(0)
    })
  })

  describe('hasFuzzyMatch', () => {
    const knownTerms = new Set(['workspace', 'dashboard'])

    test('returns true when fuzzy match exists', () => {
      expect(hasFuzzyMatch(['workspac'], knownTerms)).toBe(true)
    })

    test('returns false when no fuzzy match', () => {
      expect(hasFuzzyMatch(['hello', 'world'], knownTerms)).toBe(false)
    })

    test('returns false for short tokens', () => {
      expect(hasFuzzyMatch(['work', 'dash'], knownTerms)).toBe(false)
    })
  })
})
