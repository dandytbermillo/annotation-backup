/**
 * Unit tests for classifyExecutionMeta() — the shared single decision point.
 *
 * Per deterministic-llm-ladder-enforcement-addendum-plan.md:
 * - Rule A: One classifier function (classifyExecutionMeta)
 * - Rule B: Strict deterministic gate — only exact unique winners qualify
 * - Rule C: Unresolved → 'unknown' → dispatch MUST NOT execute
 *
 * Tests cover:
 * 1. Evidence-based classification for all matchKind values
 * 2. Coverage invariant: all deterministic matchKinds with unique winner → non-'unknown'
 * 3. Unresolved gate: partial/multi-candidate → 'unknown'
 * 4. Passthrough of resolverPath and intentTag
 */

import { classifyExecutionMeta } from '@/lib/chat/input-classifiers'
import type { ClassifyEvidence } from '@/lib/chat/input-classifiers'

// =============================================================================
// Evidence-Based Classification Tests
// =============================================================================

describe('classifyExecutionMeta — evidence-based classification', () => {
  test("'exact' + candidateCount:1 → 'explicit_label_match'", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'exact',
      candidateCount: 1,
      resolverPath: 'panelDisambiguation',
    })
    expect(meta.reasonCode).toBe('explicit_label_match')
  })

  test("'partial' + candidateCount:1 → 'unknown' (Rule B — not strict exact)", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'partial',
      candidateCount: 1,
      resolverPath: 'panelDisambiguation',
    })
    expect(meta.reasonCode).toBe('unknown')
  })

  test("'context_expand' + candidateCount:1 → 'continuity_tiebreak'", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'context_expand',
      candidateCount: 1,
      resolverPath: 'previewShortcut',
    })
    expect(meta.reasonCode).toBe('continuity_tiebreak')
  })

  test("'registry_exact' + candidateCount:1 → 'explicit_label_match'", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'registry_exact',
      candidateCount: 1,
      resolverPath: 'knownNounRouting',
    })
    expect(meta.reasonCode).toBe('explicit_label_match')
  })

  test("'ordinal' + candidateCount:1 → 'ordinal'", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'ordinal',
      candidateCount: 1,
      resolverPath: 'executeAction',
    })
    expect(meta.reasonCode).toBe('ordinal')
  })

  test("'grounding' + candidateCount:1 → 'grounding_resolved'", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'grounding',
      candidateCount: 1,
      resolverPath: 'handleGroundingSet',
    })
    expect(meta.reasonCode).toBe('grounding_resolved')
  })

  test("'exact' + candidateCount:3 → 'unknown' (not unique winner)", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'exact',
      candidateCount: 3,
      resolverPath: 'panelDisambiguation',
    })
    expect(meta.reasonCode).toBe('unknown')
  })

  test("'exact' + candidateCount:0 → 'unknown' (no candidates)", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'exact',
      candidateCount: 0,
      resolverPath: 'panelDisambiguation',
    })
    expect(meta.reasonCode).toBe('unknown')
  })
})

// =============================================================================
// Coverage Invariant (Rule B — exhaustive deterministic categories)
// =============================================================================

describe('classifyExecutionMeta — coverage invariant', () => {
  const DETERMINISTIC_UNIQUE: ClassifyEvidence['matchKind'][] = [
    'exact', 'registry_exact', 'context_expand', 'ordinal', 'grounding',
  ]

  test.each(DETERMINISTIC_UNIQUE)(
    "'%s' + candidateCount:1 classifies to non-'unknown'",
    (kind) => {
      const meta = classifyExecutionMeta({
        matchKind: kind,
        candidateCount: 1,
        resolverPath: 'unknown',
      })
      expect(meta.reasonCode).not.toBe('unknown')
    }
  )

  test("'exact' + candidateCount:3 classifies to 'unknown' (multi-candidate)", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'exact',
      candidateCount: 3,
      resolverPath: 'unknown',
    })
    expect(meta.reasonCode).toBe('unknown')
  })

  test("'partial' classifies to 'unknown' (non-exact)", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'partial',
      candidateCount: 1,
      resolverPath: 'unknown',
    })
    expect(meta.reasonCode).toBe('unknown')
  })
})

// =============================================================================
// Passthrough Tests (resolverPath + intentTag threaded through)
// =============================================================================

describe('classifyExecutionMeta — passthrough fields', () => {
  test('resolverPath is passed through unchanged', () => {
    const meta = classifyExecutionMeta({
      matchKind: 'exact',
      candidateCount: 1,
      resolverPath: 'knownNounRouting',
    })
    expect(meta.resolverPath).toBe('knownNounRouting')
  })

  test('intentTag is passed through when present', () => {
    const meta = classifyExecutionMeta({
      matchKind: 'exact',
      candidateCount: 1,
      resolverPath: 'executeAction',
      intentTag: 'open_workspace',
    })
    expect(meta.intentTag).toBe('open_workspace')
  })

  test('intentTag is undefined when not provided', () => {
    const meta = classifyExecutionMeta({
      matchKind: 'exact',
      candidateCount: 1,
      resolverPath: 'executeAction',
    })
    expect(meta.intentTag).toBeUndefined()
  })
})

// =============================================================================
// Commit/Explain Contract Tests (Rule G)
// =============================================================================

describe('classifyExecutionMeta — commit/explain contract', () => {
  test('classifier output is plain object suitable for commit-point storage', () => {
    const meta = classifyExecutionMeta({
      matchKind: 'exact',
      candidateCount: 1,
      resolverPath: 'panelDisambiguation',
      intentTag: 'open_panel',
    })
    // Must be a plain object (no Promises, no side effects)
    expect(typeof meta).toBe('object')
    expect(meta).not.toBeInstanceOf(Promise)
    expect(meta.reasonCode).toBe('explicit_label_match')
    expect(meta.resolverPath).toBe('panelDisambiguation')
    expect(meta.intentTag).toBe('open_panel')
  })

  test("'unknown' reasonCode for unresolved — safe clarifier at explain time", () => {
    const meta = classifyExecutionMeta({
      matchKind: 'partial',
      candidateCount: 1,
      resolverPath: 'panelDisambiguation',
    })
    // Stored as 'unknown' → explain reads as safe clarifier ("based on your chat request")
    expect(meta.reasonCode).toBe('unknown')
  })
})
