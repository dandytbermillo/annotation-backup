# Stage 6x.8 Phase 2 — Shared Semantic Contract

**Parent**: `stage6x8-cross-surface-semantic-routing-plan.md`
**Prerequisite**: Phase 1 audit complete (`2026-03-15-stage6x8-phase1-deterministic-tier-audit.md`)
**Status**: Draft — must be approved and checklist confirmed before Phase 3 implementation

---

## Purpose

This document locks the 8 decisions required before Phase 3 code changes begin. No Phase 3 implementation may start until each section below is confirmed.

---

## 1. Arbiter Schema

The cross-surface semantic arbiter returns one typed decision per uncertain turn:

```typescript
type CrossSurfaceSemanticDecision = {
  surface: 'note' | 'panel_widget' | 'dashboard' | 'workspace' | 'unknown'
  intentFamily: 'read_content' | 'state_info' | 'navigate' | 'mutate' | 'ambiguous'
  confidence: number  // 0.0–1.0
  reason: string      // short human-readable explanation
  intentSubtype?: 'summary' | 'question' | 'find_text'  // only for read_content
}
```

**Constraints**:
- Typed output only — no freeform text generation
- No direct execution — classification only
- No tool calls — the arbiter does not inspect, navigate, or mutate anything
- The arbiter receives: `userInput`, `activeSurface` context (which note/panel/workspace is active), and optionally the list of available surfaces

**Server route**: `app/api/chat/cross-surface-arbiter/route.ts`
**Client helper**: `lib/chat/cross-surface-arbiter.ts`

Pattern: same as `anchored-note-resolver` (client fetch → server Gemini call → typed response).

---

## 2. Migrated-Family Entry Rule

The arbiter entry rule is **phase-specific**. Each migration phase defines its own eligibility. The contract defines the general schema; the entry rule narrows per phase.

### Phase 3 entry rule (note families only)

The arbiter is called when ALL of these are true:

1. `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED === 'true'` (same gate as content-intent)
2. The turn is **note-related** (active note present OR note-reference detected in input)
3. The turn was **not** resolved by an exact deterministic win (Tiers 0–3, known-noun exact match, deterministic content-intent classifier match)
4. The turn was **not** blocked by a hard safety exclusion

If all conditions pass → call the arbiter.

### Phase 4 entry rule (future — broader surfaces)

Phase 4 will broaden eligibility to include any active surface context (visible panels, current workspace, current dashboard). That broader entry rule is **not active in Phase 3**.

### Dispatcher insertion point

Replace the current 6x.7 resolver branch. The arbiter absorbs that seam rather than adding a new one.

Conceptually:

```
// Current (6x.7):
if (classifierMatch) {
  // deterministic content path
} else if (activeNoteId && !hardExcluded) {
  // anchored-note resolver
}

// Phase 3 (6x.8):
if (classifierMatch) {
  // deterministic content path (unchanged)
} else if (isNoteRelated && !hardExcluded) {
  // cross-surface arbiter (note-family entry only in Phase 3)
}
```

The entry condition stays note-scoped in Phase 3. This prevents the arbiter from classifying non-note turns and then falling through to legacy routing — which would create double-LLM calls for non-migrated families.

---

## 3. Migrated-Family Gate

After the arbiter returns a `surface + intentFamily` pair, the dispatcher checks whether that pair is currently migrated:

**Phase 3 migrated pairs**:
- `note + read_content` → Stage 6 handoff
- `note + state_info` → deterministic note-state resolver

**Not migrated (fall through to existing routing)**:
- `panel_widget + *` (Phase 4)
- `dashboard + *` (Phase 4)
- `workspace + *` (Phase 4)
- `* + navigate` (deferred)
- `* + mutate` → immediate not-supported response (never falls through)

**Unknown surface**:
- `unknown + *` → fallback clarification (never executes, never falls through silently)

```typescript
const MIGRATED_PAIRS: Set<string> = new Set([
  'note:read_content',
  'note:state_info',
])

function isMigrated(decision: CrossSurfaceSemanticDecision): boolean {
  return MIGRATED_PAIRS.has(`${decision.surface}:${decision.intentFamily}`)
}
```

When not migrated and not a special case (mutate/unknown), the turn falls through to existing routing tiers. The arbiter call is not wasted — its telemetry still records what the arbiter would have done (shadow value for Phase 4 planning).

---

## 4. Stage 6 Handoff

When the arbiter returns `note + read_content` with confidence above threshold:

1. Set `contentIntentMatchedThisTurn = true`
2. Build `contentContext` from active note:
   ```typescript
   contentContext: {
     noteItemId: activeNoteId,
     noteTitle: activeNote?.title ?? 'Untitled',
     anchorSource: 'active_widget',
     intentType: /* from arbiter if available, else default to 'question' */,
   }
   ```
3. Build `s6Params` (same shape as existing classifier/resolver path)
4. Call `executeS6Loop(s6Params)` — single-execution rule
5. Surface answer, write durable log — same as existing 6x.5 path

**intentType mapping**: The arbiter's schema does not include `intentType` (`summary | question | find_text`). Options:
- **Option A**: Add `intentSubtype` to the arbiter schema for `read_content` decisions
- **Option B**: Default to `'question'` (broadest category) and let Stage 6 infer from the user's actual query

**Decision**: Option A. Add optional `intentSubtype` to the arbiter response:

```typescript
type CrossSurfaceSemanticDecision = {
  surface: 'note' | 'panel_widget' | 'dashboard' | 'workspace' | 'unknown'
  intentFamily: 'read_content' | 'state_info' | 'navigate' | 'mutate' | 'ambiguous'
  confidence: number
  reason: string
  intentSubtype?: 'summary' | 'question' | 'find_text'  // only for read_content
}
```

The arbiter prompt should instruct: when `intentFamily=read_content`, also classify `intentSubtype`.

---

## 5. State-Info Resolvers

Each surface gets a deterministic bounded resolver that answers from live app state. No LLM. No freeform generation.

### note.state_info

**Source**: `uiContext.workspace.activeNoteId` + `uiContext.workspace.openNotes`

| Query pattern | Response |
|--------------|----------|
| Active note exists | "The open note is {title}." |
| Multiple notes open | "The active note is {title}. {N} notes are open." |
| No note open | "No note is currently open." |

### panel_widget.state_info (Phase 4)

**Source**: Widget snapshot registry, visible panel state

| Query pattern | Response |
|--------------|----------|
| Panels visible | "The visible panels are: {list}." |
| No panels | "No panels are currently visible." |

### workspace.state_info (Phase 4)

**Source**: Current workspace/session state

| Query pattern | Response |
|--------------|----------|
| Workspace active | "You are in workspace {name}." |

### dashboard.state_info (Phase 4)

**Source**: Current dashboard/UI state

| Query pattern | Response |
|--------------|----------|
| Dashboard active | "The current dashboard has {N} widgets." |

**Implementation pattern**: Each resolver is a pure function:

```typescript
function resolveNoteStateInfo(uiContext: UIContext): string {
  const activeNoteId = uiContext.workspace?.activeNoteId
  if (!activeNoteId) return 'No note is currently open.'
  const activeNote = uiContext.workspace?.openNotes?.find(n => n.id === activeNoteId)
  return `The open note is ${activeNote?.title ?? 'Untitled'}.`
}
```

The dispatcher builds a `ChatMessage` from the resolver's string and returns early (same pattern as the current resolver ambiguous clarifier path).

---

## 6. Confidence Threshold

**Confirmed**: `0.75`

- `confidence >= 0.75` → authoritative for the returned `surface + intentFamily`
- `confidence < 0.75` → treated as unresolved; falls to clarification or existing routing depending on migration status
- Low-confidence normalization: telemetry records raw `decision` and `confidence`, but `effectiveResult` is normalized to `'ambiguous'` when below threshold (same pattern as 6x.7 resolver)

Phase 5 telemetry should track threshold-boundary cases (0.70–0.80) to evaluate whether adjustment is needed.

---

## 7. Latency Rule

For any turn that enters the arbiter:

1. **One bounded arbiter call** — the cross-surface arbiter
2. **Then deterministic resolution** — Stage 6 handoff, state-info resolver, or fallback
3. **No second LLM call** for the same classification decision

The arbiter replaces (not stacks on) the existing 6x.7 anchored-note resolver for migrated pairs. When Phase 3 ships:
- `note.read_content` → arbiter (not 6x.7 resolver + arbiter)
- `note.state_info` → arbiter + deterministic resolver (not arbiter + LLM)

B1/B2 semantic memory lookups remain as cheap pre-arbiter signals. They are not LLM calls and do not count against the latency budget.

**Timeout**: Same as anchored-note resolver — 2000ms server-side via `Promise.race`, 2500ms client-side.

---

## 8. Fallback Policies

### unknown surface

`surface=unknown` with any `intentFamily`:
- Never executes
- Never silently falls through
- Produces: "I'm not sure what you're referring to. Could you be more specific?"

### Non-note read_content

`surface=panel_widget|dashboard|workspace` + `intentFamily=read_content`:
- Not migrated until that surface has a bounded content reader
- Falls through to existing routing (not to Stage 6)
- If existing routing also doesn't handle it: safe clarifier

### mutate

`intentFamily=mutate` with any surface:
- Never executes in 6x.8
- Produces: "I can help with reading and navigating, but I can't modify content yet."
- Never falls through silently

### ambiguous

`intentFamily=ambiguous` with any surface:
- Falls to clarification
- Phase 3 (note-only entry): "Do you want me to explain the current note, or navigate somewhere else?"
- Phase 4+ (cross-surface entry): clarifier copy should be surface-aware, not note-specific

### Low confidence (below 0.75)

- Not migrated pair: fall through to existing routing
- Migrated pair: fall to clarification (don't execute on low confidence)

---

## Arbiter Prompt (Draft)

```
You are a UI intent classifier for an annotation application.

The user has the following active context:
- Active note: {noteTitle or "none"}
- Visible panels: {panelList or "none"}
- Current workspace: {workspaceName}

Classify the user's request into:

1. surface: which part of the app is the user referring to?
   - "note" — the note/document content
   - "panel_widget" — a panel or widget on the dashboard
   - "dashboard" — the overall dashboard view
   - "workspace" — the workspace/environment
   - "unknown" — cannot determine

2. intentFamily: what does the user want to do?
   - "read_content" — read, summarize, explain, find text in content
   - "state_info" — ask what is open, active, visible, or current
   - "navigate" — open, go to, switch to something
   - "mutate" — edit, add, remove, rename, highlight something
   - "ambiguous" — unclear intent

3. If intentFamily is "read_content", also provide intentSubtype:
   - "summary" — summarize or overview
   - "question" — answer a question about content
   - "find_text" — search or find specific text

Set confidence between 0 and 1. Only use >= 0.75 when intent is clearly one category.
If unclear, return "ambiguous" — do NOT guess.

Respond with JSON only.
```

---

## Files for Phase 3 Implementation

| File | Change |
|------|--------|
| `lib/chat/cross-surface-arbiter.ts` | **NEW** — client helper |
| `app/api/chat/cross-surface-arbiter/route.ts` | **NEW** — server route |
| `lib/chat/state-info-resolvers.ts` | **NEW** — deterministic state-info resolvers |
| `lib/chat/routing-dispatcher.ts` | Replace 6x.7 resolver branch with arbiter + migrated-family gate |
| `lib/chat/routing-log/payload.ts` | Add arbiter telemetry fields |
| `app/api/chat/routing-log/route.ts` | Serialize arbiter telemetry |
| `__tests__/unit/chat/cross-surface-arbiter.test.ts` | **NEW** — arbiter unit tests |
| `__tests__/unit/chat/state-info-resolvers.test.ts` | **NEW** — resolver unit tests |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | Update integration tests for arbiter path |

---

## Design-Lock Checklist

All 8 items must be confirmed before Phase 3 code begins:

- [ ] Arbiter schema (§1)
- [ ] Migrated-family entry rule (§2)
- [ ] Migrated-family gate (§3)
- [ ] Stage 6 handoff + intentSubtype (§4)
- [ ] State-info resolvers (§5)
- [ ] Confidence threshold (§6)
- [ ] Latency rule (§7)
- [ ] Fallback policies (§8)
