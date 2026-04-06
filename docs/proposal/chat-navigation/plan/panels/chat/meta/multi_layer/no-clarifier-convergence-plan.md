# No-Clarifier Convergence to Shared Semantic Pipeline

## Purpose

Migrate the no-clarifier routing path to the same shared semantic pipeline used by active clarification. Currently, no-clarifier mode has independent surface resolver and known-noun winner lanes that execute before semantic retrieval gets a chance. The target architecture uses one shared pipeline for both modes.

## Problem Statement

The no-clarifier path currently has three competing retrieval/execution systems:

1. **Surface resolver** — independent retrieval (own embeddings, own rewrite, own arbitration), executes directly with `deterministic_surface` provenance before semantic runs
2. **Known-noun routing** — static allowlist matching, executes directly at Tier 4 before semantic runs
3. **Stage 5 semantic replay** — only runs if neither surface nor known-noun handled the turn

The plan's target architecture says: one shared pipeline, semantic as the single retrieval system, surface-manifest as policy/enrichment (not a separate router).

## What Changes

### Remove as independent no-clarifier winner lanes:

- **Surface resolver direct execution** — no longer returns `handled: true`, and its independent retrieval/scoring pipeline is removed from no-clarifier mode. Surface-manifest logic remains only as shared validation/policy.
- **Known-noun direct execution** — no longer returns `handled: true` from Tier 4 allowlist matching. Its product policies survive as shared validation.

### Keep as shared pipeline components:

- **Semantic retrieval** (`lookupSemanticHints`) — single retrieval system for both modes
- **Rewrite-assisted re-query** — available in shared retrieval core
- **Surface-manifest validation** — execution policy, container compatibility, visibility checks applied to semantic candidates
- **Known-noun product rules** — duplicate-family deferral, visibility, question/docs guards applied as shared validation

### Execution mode difference:

- **No clarifier:** if one candidate is strong and valid after shared validation, execute directly
- **Active clarifier:** pass validated candidates + clarifier options to bounded arbiter, execute only after selection

## Current No-Clarifier Flow (to be migrated)

```
1. Surface resolver runs → high confidence? → execute directly (handled: true) → DONE
2. Stage 5 semantic replay → replay-eligible? → execute via buildResultFromMemory → DONE
3. Known-noun routing → match? → execute directly (handled: true) → DONE
4. Tier 4.5 grounding → LLM → clarifier
```

## Target No-Clarifier Flow

```
1. Semantic retrieval (lookupSemanticHints) → candidates
2. Collect validated active-panel item evidence and validated note-sibling evidence
3. If weak/empty → rewrite-assisted re-query → more candidates
4. Merge/dedupe candidates
5. Enrich with surface-manifest validation (execution policy, container, visibility)
6. Apply known-noun product rules (duplicate-family, question guard)
7. If one strong valid candidate → execute directly
8. If candidates are useful but not execution-safe → prefer clarification from that shared candidate set before any generic downstream execution
9. Bounded LLM in no-clarifier mode is constrained to the shared candidate set: it may arbitrate among those candidates or decide that a new clarification is needed
10. Only after the shared candidate path is exhausted may generic downstream execution run
11. If the shared candidate set is empty and downstream fallback still does not yield a safe winner, the final outcome must be clarification
```

## Migration Strategy

### Phase 1: Surface Retrieval Removal

Remove the surface resolver's independent retrieval pipeline from the no-clarifier path:

1. Surface resolver no longer runs its own retrieval (embeddings, rewrite, arbitration) in no-clarifier mode
2. Semantic retrieval (`lookupSemanticHints`) is the single retrieval system — same as active clarification
3. Validated active-panel item evidence and validated note-sibling evidence remain available in no-clarifier mode as shared candidate sources, consistent with the parent plan
4. Rewrite-assisted re-query stays available in the shared retrieval core (already wired)
5. Surface-manifest validation (execution policy, container, visibility) is applied to semantic candidates as enrichment — not as a separate retrieval source

**Key change:** Surface retrieval pipeline is removed, not downgraded to "candidate source." There is one retrieval system (semantic), not two.

**What stays from surface:** Manifest definitions, execution policies, container/visibility validation — all as shared policy applied to semantic candidates.

**What goes away:** `lookupSurfaceSeeds`, `rewriteForRetrieval` (surface-specific), `arbitrateSurfaceCandidates`, `evaluateCandidates` — the entire independent retrieval/scoring/arbitration pipeline.

**Seed coverage prerequisite:** Before removal, verify semantic seeds cover all command families currently reachable only through the surface resolver's own retrieval. If gaps exist, add semantic seeds first.

### Phase 2: Known-Noun Convergence

Remove known-noun as an independent winner lane. Migrate each current behavior explicitly:

1. Known-noun routing no longer returns `handled: true` at Tier 4
2. Product validation rules migrate to shared pipeline validation (already exported as shared helpers)
3. Temporary exception: the current unknown-noun "Open or Docs?" fallback may remain during migration until semantic/no-clarifier parity is proven for that case; it is not part of the target steady state

**Explicit migration for each current known-noun behavior:**

| Current behavior | Location | Migration |
|-----------------|----------|-----------|
| Exact noun match → deterministic open | `known-noun-routing.ts:461` | Removed as independent execution. Semantic candidate + manifest validation handles this. |
| Trailing-? open-vs-docs disambiguation ("links panel?") | `known-noun-routing.ts:362-448` | **Preserve** — migrate to shared pipeline as a question-guard check applied to semantic candidates. If input is `{noun}?`, show open-vs-docs prompt instead of executing. |
| Full question → skip to docs ("what is links panel?") | `known-noun-routing.ts:450-458` | **Preserve** — already extracted as `detectQuestionGuard()`. Applied in shared pre-execution validation. |
| Fuzzy near-match → "Did you mean ___?" | `known-noun-routing.ts:596-696` | **Preserve** — migrate to shared pipeline. When semantic candidate is weak but a known-noun near-match exists, show "Did you mean?" instead of executing or clarifying blindly. |
| Unknown noun → "Open or Docs?" fallback | `known-noun-routing.ts:698-751` | **Temporary rule: preserve current fallback until semantic/no-clarifier parity is proven for this case**. After parity is proven, either migrate it into the shared pipeline explicitly or remove it in a follow-up cleanup. |
| Duplicate-family deferral | `known-noun-routing.ts:519-537` | **Preserve** — already extracted as `validateDuplicateFamily()`. Applied in shared validation. |
| Visibility check | `known-noun-routing.ts:466-514` | **Preserve** — already extracted as `validateVisibility()`. Applied in shared validation. |

**Key change:** Known-noun stops being a separate winner lane. Its product rules and UX behaviors survive through explicit migration, not silent deletion.

### Phase 3: Provenance Unification

1. Remove `deterministic_surface` from `ChatProvenance` type
2. Replace with appropriate shared-pipeline provenance:
   - Strong semantic candidate → `memory_semantic`
   - Surface-manifest-validated semantic candidate → `memory_semantic` (manifest validation is policy, not provenance source)
3. Remove `deterministic_surface` badge from `ChatMessageList.tsx`
4. Known-noun provenance → absorbed into the shared pipeline provenance

### Phase 4: Cleanup

1. Surface resolver module stays only as manifest validation/helper logic; its independent retrieval/scoring/execution responsibilities are removed
2. Known-noun routing module stays for no-clarifier product validation, but its Tier 4 direct-execution path is removed
3. Tests rebaselined to expect shared-pipeline behavior

## What Stays

- `lib/chat/surface-resolver.ts` — narrowed to manifest validation/helper logic only
- `lib/chat/surface-manifest.ts` — execution policy definitions
- `lib/chat/surface-manifest-definitions.ts` — built-in widget command semantics
- `lib/chat/known-noun-routing.ts` — product validation helpers (already exported as shared validators)
- Rewrite-assisted retrieval
- Validated active-panel item evidence in no-clarifier mode
- Validated note-sibling evidence in no-clarifier mode
- All execution policies (open_surface, list_items, execute_item)

## What Goes Away

- Surface resolver's independent retrieval pipeline (`lookupSurfaceSeeds`, surface-specific `rewriteForRetrieval`, `arbitrateSurfaceCandidates`, `evaluateCandidates`)
- Surface resolver returning `handled: true` in no-clarifier mode
- Known-noun returning `handled: true` at Tier 4 in no-clarifier mode
- `deterministic_surface` provenance
- Two competing retrieval systems — only semantic remains

## Seed Coverage Prerequisite

Before removing surface as a no-clarifier winner, semantic seeds must cover all command families currently handled by the surface resolver. The existing curated seeds cover:
- `open recent` family (already seeded)
- `show recent` / `list recent` family (already seeded)

Additional seeds may be needed for families currently only reachable through the surface resolver's own retrieval.

## Edge Cases

1. **Surface catches commands that semantic doesn't have seeds for** — verify seed coverage before migration
2. **Known-noun catches bare nouns ("recent", "navigator")** — semantic may not match bare nouns without command verbs; may need seeds or lower threshold
3. **Rewrite recovery** — currently lives in surface resolver; needs to stay available in shared pipeline (already wired for active-clarifier escape)
4. **Manifest-fallback hints** — surface resolver synthesizes candidates when retrieval is empty but manifest overlap exists; this should survive as a bounded helper folded into the shared semantic pipeline, not as a separate candidate source or direct-execution path

## Regression Matrix

Must pass after migration:

- `open recent` → opens Recent (was Deterministic-Surface, now Memory-Semantic)
- `open recent widget` → opens Recent
- `hi can you pls open recent widget` → opens Recent (was incorrectly labeled Deterministic-Surface)
- `show recent` / `list my recent entries` → list_items response in chat (manifest execution policy preserved)
- `show recent widget entries` → list_items response in chat
- no-clarifier manifest-fallback helper case with strong runtime/manifest overlap and weak semantic retrieval → contributes bounded helper shaping without becoming a separate lane or direct-executing by itself
- `open links panel b` → opens Links Panel B
- `can you pls open widget manager` → opens Widget Manager
- `open that budget100` → opens entry (when Links Panel B is active)
- `open entries` → multi-option clarifier (not deterministic)
- `links panel?` → open-vs-docs disambiguation prompt (trailing-? preserved)
- `what is links panel?` → skip to docs (question guard preserved)
- `widgt managr` → "Did you mean Widget Manager?" (fuzzy near-match preserved)
- `navigator` (bare noun) → opens Navigator or clarifies (bare noun handling preserved)
- no-clarifier note sibling follow-up with valid note target → executes through the shared candidate pipeline
- no-clarifier note sibling follow-up with invalid/ambiguous note target → clarifies instead of guessing
- All active-clarifier flows unchanged

Must not happen:

- Surface resolver independently executes before semantic pipeline
- Known-noun independently executes at Tier 4
- Regression in any currently working command
- Lost manifest validation (execution policy, container, visibility)

## Non-Goals

This plan does not:

- Change active-clarifier behavior (already on shared pipeline)
- Remove surface-manifest definitions or execution policies
- Remove known-noun product validation rules
- Implement new command families

## Anti-Pattern Applicability

The isolation/reactivity anti-pattern guidance is not applicable here. This is a routing convergence plan.
