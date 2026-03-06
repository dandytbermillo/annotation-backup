# Semantic Memory Clarifier Assist — Phase 3c

**Status:** Design note (pre-implementation)
**Parent:** Multi-Layer Routing Reliability Plan v3.5
**Predecessor:** Phase 3a (B2 telemetry, validated), Phase 3b (Lane D hint injection, frozen)
**Date:** 2026-03-05

---

## 1) Why this exists

Phase 3b (Lane D hint injection) was found to be structurally unreachable under current architecture:
- Gate 3 requires the target widget+item to be in the live UI snapshot for validation
- When the target is present, grounding tiers (4/4.5) also handle the query → `result.handled = true`
- Lane D injection requires `!result.handled` → near-zero coverage in practice
- See: `docs/proposal/chat-navigation/reports/2026-03-05-b2-telemetry-and-lookup-status-fix.md` § "Phase 3b Structural Analysis"

Phase 3c uses B2 semantic memory at a different decision point: **clarifier option ranking**. This bypasses the coverage gap because clarification happens when tiers DO handle (with ambiguity), not when they don't.

---

## 2) Contract (non-negotiable)

1. **Reorder only** — Semantic memory can reorder existing clarifier options. It MUST NOT add new options.
2. **No auto-execute** — Reordering does not grant execution authority. The user still picks from the list.
3. **No tier bypass** — Tiers 0-5 remain authoritative. B2 candidates do not skip any tier or validation gate.
4. **Existing validators stay authoritative** — Gate 3 validation, risk tier checks, grounding set membership are unchanged.
5. **Shadow first** — Initial deployment observes and logs reordering decisions without changing user-visible behavior. Promotion to active requires soak evidence.

---

## 3) How it works

### Current clarifier flow (without 3c)

When Tier 4.5 grounding produces multiple candidates and the grounding LLM returns `need_more_info` (or is disabled), the system builds a clarifier:

1. `buildGroundedClarifier(candidates)` — composes the clarifier message (`routing-dispatcher.ts:822`)
2. `bindGroundingClarifierOptions(ctx, candidates, messageId)` — orders and binds options (`routing-dispatcher.ts:859`)
3. Options are shown to the user in the order produced by the grounding set

The current ordering is determined by the grounding set's internal ranking (insertion order / type grouping). There is no preference signal.

### Proposed clarifier flow (with 3c)

B2 semantic memory provides a **preference signal**: "for similar past queries, the user chose this target." This signal reorders clarifier options so the most likely choice appears first.

1. B2 runs before the tier chain (`routing-dispatcher.ts:1239-1286`) — already implemented
2. When clarifier construction fires, check if any B2 candidate's `itemId`/`candidateId` matches a grounding candidate's `id`
3. If match found: move the matching candidate to position 1 (first option shown)
4. If no match or B2 returned empty: no change (original ordering preserved)

### ID matching

B2 candidates use `slots_json.itemId` (for `execute_widget_item`) or `slots_json.candidateId` (for `execute_referent`).
Grounding candidates use `GroundingCandidate.id`.

Match condition: `groundingCandidate.id === b2Candidate.slots_json.itemId || groundingCandidate.id === b2Candidate.slots_json.candidateId`

If multiple B2 candidates match multiple grounding candidates, sort matched candidates by `similarity_score` DESC and place them before unmatched candidates.

---

## 4) Why coverage is better than Phase 3b

| Condition | Phase 3b (Lane D) | Phase 3c (Clarifier) |
|-----------|-------------------|----------------------|
| Requires `!result.handled` | Yes | No |
| Requires tier chain ambiguity | No | Yes |
| Widget must be present | Yes (Gate 3) | Yes (Gate 3 + grounding) |
| B2 and grounding overlap | **Causes dead path** | **Enables ranking** |

The structural problem of 3b — B2 and grounding operating on the same object set — becomes an advantage in 3c. B2 tells us WHICH grounding candidate the user likely wants.

---

## 5) Flag and shadow mode

**New flag:** `NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_ASSIST_ENABLED`

- Client-side flag (`NEXT_PUBLIC_` prefix) because `dispatchRouting()` and clarifier construction run client-side in the dispatcher
- Default: `false`
- Depends on: `NEXT_PUBLIC_CHAT_ROUTING_MEMORY_SEMANTIC_READ=true` (Phase 3a must be active)

### Shadow mode

When enabled, the reordering logic runs but:
- Computes the reordered candidate list
- Logs telemetry (see §6) with what WOULD have changed
- Returns the ORIGINAL ordering to the user

Promotion to active: change shadow mode to apply the reordered list when soak metrics show improvement.

---

## 6) Telemetry

### 6a) Clarifier assist fields

Extend `semantic_hint_metadata` with clarifier assist fields:

```
b2_clarifier_status: 'not_applicable' | 'no_b2_empty' | 'no_b2_timeout' | 'no_b2_error' | 'no_match' | 'matched_no_reorder' | 'reordered' | 'shadow_reordered'
b2_clarifier_match_count: number        // how many grounding candidates matched B2 candidates
b2_clarifier_top_match_rank: number     // original rank (1-based) of the top B2-matched candidate before reordering
b2_clarifier_top_score: number          // similarity score of the top matched B2 candidate
b2_clarifier_top_match_id: string       // ID of the top B2-matched grounding candidate
b2_clarifier_message_id: string         // clarifier message ID (for correlating with user's later selection)
b2_clarifier_option_ids: string[]       // ordered list of grounding candidate IDs as shown (original order in shadow, reordered in active)
```

Status values (preserves Phase 3a lookup status precision):
- `not_applicable` — B2 not attempted (disabled, flag off, or not B2-eligible), OR no clarifier was shown this turn
- `no_b2_empty` — B2 succeeded but returned zero usable candidates (includes: API returned empty, or candidates existed but all failed Gate 3 validation)
- `no_b2_timeout` — B2 client timeout or server-side embedding timeout
- `no_b2_error` — B2 embedding failure or server error
- `no_match` — B2 returned validated candidates but none matched grounding candidates by ID
- `matched_no_reorder` — B2 matched a grounding candidate but the top match was already at position 1 (no visible change would occur)
- `reordered` — B2 matched and reordering was applied (active mode)
- `shadow_reordered` — B2 matched and reordering would have changed visible order, but was only logged, not applied (shadow mode)

Note: `no_b2_empty`, `no_b2_timeout`, and `no_b2_error` map directly from the Phase 3a `SemanticLookupResult.status` values (`empty`, `timeout`, `error`). `not_applicable` covers both `undefined` (not attempted) and `disabled` B2 lookup statuses. This preserves the disambiguation between "no semantic hits" and "lookup failed" that Phase 3a established.

### 6b) Selection correlation — storage contract

To evaluate the promotion metric ("user's eventual pick would have been rank 1 in reordered order"), the system must correlate the clarifier-shown turn with the user's subsequent selection turn. These are **separate durable log rows** with **different `interaction_id` values**.

**Current gap:** Neither `selected_option_id` nor `clarifier_message_id` is stored in the durable log today. Both must be added.

#### Data available at each turn

**Clarifier turn** (when grounding clarifier is shown):
- `clarifierMsgId` = `assistant-${Date.now()}` — generated at clarifier construction (`routing-dispatcher.ts:2186, 4577, 4625, 4684`)
- `GroundingCandidate[].id` — the option IDs in display order
- B2 reorder data (match count, top match ID, original rank, score)

**Selection turn** (when user picks an option):
- `ctx.lastClarification?.messageId` — carries the `clarifierMsgId` of the clarifier that spawned this selection (`chat-navigation-context.tsx:108`)
- Selected option's `.id` — available at each `handleSelectOption` call site (e.g., `matchedOption.id` at `routing-dispatcher.ts:3252`, `optionToSelect.id` at `3697`)

#### Storage locations

All fields go into `semantic_hint_metadata` (JSONB NULL, schema-less — no migration needed).

**On the clarifier turn** — written when `bindGroundingClarifierOptions` is called:

| Field | Source | Example |
|-------|--------|---------|
| `b2_clarifier_message_id` | `clarifierMsgId` | `"assistant-1709625432100"` |
| `b2_clarifier_option_ids` | `candidates.map(c => c.id)` (display order) | `["id-abc", "id-def", "id-ghi"]` |
| `b2_clarifier_top_match_id` | Top B2-matched candidate ID | `"id-def"` |
| `b2_clarifier_top_match_rank` | Original 1-based rank of top match | `2` |
| `b2_clarifier_top_score` | B2 similarity score | `0.924` |
| `b2_clarifier_status` | See §6a | `"shadow_reordered"` |

**On the selection turn** — written when `handleSelectOption` executes:

| Field | Source | Example |
|-------|--------|---------|
| `clarifier_origin_message_id` | `ctx.lastClarification?.messageId` | `"assistant-1709625432100"` |
| `selected_option_id` | `optionToSelect.id` or `matchedOption.id` | `"id-def"` |

**Join condition:** `clarifier_origin_message_id = b2_clarifier_message_id`

#### Correlation query

```sql
-- Correlate clarifier-shown turn with user's selection turn
WITH clarifier_turns AS (
  SELECT
    semantic_hint_metadata->>'b2_clarifier_message_id' AS msg_id,
    semantic_hint_metadata->>'b2_clarifier_status' AS status,
    semantic_hint_metadata->>'b2_clarifier_top_match_id' AS top_match_id,
    (semantic_hint_metadata->>'b2_clarifier_top_match_rank')::int AS top_match_rank,
    semantic_hint_metadata->'b2_clarifier_option_ids' AS option_ids
  FROM chat_routing_durable_log
  WHERE semantic_hint_metadata->>'b2_clarifier_message_id' IS NOT NULL
    AND semantic_hint_metadata->>'b2_clarifier_status' IN ('shadow_reordered', 'reordered')
),
selection_turns AS (
  SELECT
    semantic_hint_metadata->>'clarifier_origin_message_id' AS origin_msg_id,
    semantic_hint_metadata->>'selected_option_id' AS selected_id
  FROM chat_routing_durable_log
  WHERE semantic_hint_metadata->>'clarifier_origin_message_id' IS NOT NULL
)
SELECT
  c.status,
  c.top_match_id,
  c.top_match_rank,
  c.option_ids,
  s.selected_id,
  (c.top_match_id = s.selected_id) AS reorder_would_have_helped
FROM clarifier_turns c
JOIN selection_turns s ON s.origin_msg_id = c.msg_id;
```

#### Implementation checklist

1. **Clarifier turn**: At each `bindGroundingClarifierOptions` call site, enrich `logPayload.semantic_hint_metadata` (or a holder variable) with `b2_clarifier_message_id` and `b2_clarifier_option_ids`. B2 reorder fields are set by the reorder function.
2. **Selection turn**: At each `handleSelectOption` call site in the dispatcher, capture `ctx.lastClarification?.messageId` and the selected option's `.id` into `logPayload`. Write both as `clarifier_origin_message_id` and `selected_option_id` in `semantic_hint_metadata`.
3. **Route handler**: Extend `semanticHintMeta` JSON builder in `app/api/chat/routing-log/route.ts` to serialize the new fields.
4. **No migration**: All fields are JSONB keys in the existing `semantic_hint_metadata` column.

---

## 7) Soak protocol

### Baseline (before 3c)

Capture current clarifier behavior:
- How often clarification is triggered (clarifier rate)
- When clarification shows, which option does the user pick? (first-choice rate = % picking option 1)
- Follow-up turns needed after clarification (1 = direct pick, 2+ = re-clarification or confusion)

### With 3c (shadow)

Enable flag, run 10+ clarifier-triggering queries:
- `b2_clarifier_status` distribution
- When `shadow_reordered`: use the selection correlation query (§6b) to check whether the user's eventual pick matches `b2_clarifier_top_match_id`
- Compare `b2_clarifier_top_match_rank` (original rank of the B2-preferred candidate) against the user's actual pick position

### Promotion criteria

Promote from shadow to active when:
1. `shadow_reordered` turns where `b2_clarifier_top_match_id = selected_option_id` is ≥60% (B2's top match is what the user actually wanted)
2. No safety regressions (no high-risk actions slipping through)
3. Latency impact negligible (<5ms total added)

---

## 8) Scope boundaries

### In scope
- Reorder `GroundingCandidate[]` before `buildGroundedClarifier` / `bindGroundingClarifierOptions`
- Telemetry for reordering decisions
- Shadow mode with flag

### Out of scope (explicitly deferred)
- Adding new options from B2 memory (violates contract §2.1)
- Auto-executing the top B2 match without clarification (violates contract §2.2)
- Using B2 for clarification LLM's `preferredCandidateId` hint (possible future extension, but not in initial scope)
- Phase 3b Lane D injection (frozen, separate flag)
- Broadening B2 memory sources (cross-session, cross-entry) — prerequisite for 3b revival, independent track

---

## 9) Files to modify

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts` | Add reorder logic before clarifier construction call sites |
| `lib/chat/routing-log/payload.ts` | Add `b2_clarifier_*` telemetry fields |
| `app/api/chat/routing-log/route.ts` | Serialize new fields into `semantic_hint_metadata` |
| `.env.local` | Add `NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_ASSIST_ENABLED=false` |
| `__tests__/unit/routing-log/` | New test for reordering logic |

---

## 10) Revisit conditions for Phase 3b

Phase 3b (Lane D injection) remains frozen. Revisit only when:
1. Memory sources broaden beyond current widget-item actions
2. Hints target clarifier ranking (this plan) proves the pattern, enabling extension to Lane D
3. Tier 4/4.5 authority scope is redesigned

---

## 11) Next steps

1. Implement reordering function (pure, testable: takes `GroundingCandidate[]` + `SemanticCandidate[]`, returns reordered `GroundingCandidate[]`)
2. Wire into dispatcher at clarifier construction call sites (shadow mode)
3. Add telemetry fields and serialization
4. Unit test the reorder function
5. Soak: trigger clarification scenarios, collect shadow telemetry
6. Evaluate promotion criteria
