# Stage 6 — Slice 6.7.3: open_panel Evidence Gate

**Date**: 2026-03-12
**Status**: CLOSED (prompt-first behavior validated; evidence gate unit-proven safety net)

## Summary

Implemented an evidence-based act/clarify boundary for `open_panel` actions in the Stage 6 agent tool loop. Rather than relying on numeric confidence thresholds (which the Gemini structured-output contract does not expose), the evidence gate inspects the dashboard widget list to determine whether the model's chosen panel target is unambiguous.

## Design

The evidence gate runs server-side in `app/api/chat/stage6-loop/route.ts` **after** `validateOpenPanel()` confirms the target exists. It extracts the base name from panel labels (stripping trailing single-character badge suffixes like " A", " B") and counts siblings sharing that base name.

- **Single match** (`allowed`): Action proceeds to execution.
- **Badge siblings** (`ambiguous_siblings`): Action downgraded to `clarification_accepted` — the model is not trusted to distinguish badge variants without user confirmation.

`target_not_found` exists as an internal defensive type but is unreachable in the persisted telemetry path — `validateOpenPanel()` rejects unknown panels before the evidence gate runs.

Non-`open_panel` actions bypass the gate entirely (gate is `open_panel`-only for this slice).

## Key Functions

### `extractBaseName(label: string): string`
Strips trailing single-character badge suffix and lowercases. E.g., `"Links Panel A"` → `"links panel"`.

### `evaluateOpenPanelEvidence(panelSlug, dashboardWidgets): EvidenceGateResult`
Finds target widget by slug, extracts base name, counts siblings. Returns `{ allowed, reason, siblingCount?, siblingIds? }`.

## Files Modified

| File | Change |
|------|--------|
| `app/api/chat/stage6-loop/route.ts` | Added `extractBaseName`, `EvidenceGateResult`, `evaluateOpenPanelEvidence`; wired gate after `validateAction` for `open_panel`; refined Prompt Rule 6 for badge variants |
| `lib/chat/stage6-tool-contracts.ts` | Added `s6_evidence_gate` and `s6_evidence_sibling_count` to `S6LoopTelemetry` |
| `lib/chat/routing-log/payload.ts` | Added `s6_evidence_gate` and `s6_evidence_sibling_count` to `RoutingLogPayload` |
| `lib/chat/stage6-loop-controller.ts` | Added evidence gate fields to both `writeDurableShadowLog` and `writeDurableEnforcementLog` |
| `app/api/chat/routing-log/route.ts` | Added evidence gate fields to `semantic_hint_metadata` JSON serialization |
| `__tests__/unit/chat/stage6-loop-route.test.ts` | Added §13: 5 evidence gate tests |

## Telemetry

Durable log pipeline:
`S6LoopTelemetry.s6_evidence_gate` → `RoutingLogPayload.s6_evidence_gate` → `routing-log/route.ts` → `semantic_hint_metadata` JSONB column

Persisted enum values: `'allowed'` | `'ambiguous_siblings'` (only these two are reachable).

## Test Results

5 new tests in §13 of `stage6-loop-route.test.ts`:
1. Allows `open_panel` when target has no badge siblings → `action_executed`, `evidence_gate=allowed`
2. Downgrades to clarify when target has badge siblings → `clarification_accepted`, `evidence_gate=ambiguous_siblings`, `sibling_count=3`
3. Allows `open_panel` for non-badge unique panel among siblings of other type → `action_executed`, `evidence_gate=allowed`
4. Passes through non-`open_panel` actions without evidence gate → `action_executed`, `evidence_gate=undefined`
5. Records evidence gate pass on two-badge panel with only one visible → `action_executed`, `evidence_gate=allowed`

All 83 Stage 6 tests pass (78 existing + 5 new).

## Runtime Validation

With the full default dashboard (all panels including Links Panel A/B/C visible), the model itself clarifies on badge-variant queries — Prompt Rule 6 hardening is effective. The evidence gate serves as a safety net that would catch any model regression where it attempts to guess a badge variant instead of clarifying.

The gate was **not triggered** in runtime testing because the prompt hardening (Slice 1) successfully teaches the model to clarify voluntarily. This is the desired behavior: prompt-first, gate-as-backstop.

## Risks / Limitations

- Base-name extraction uses a simple regex (`/\s+[A-Za-z0-9]$/`) — sufficient for current panel naming convention but may need refinement if panels adopt multi-character suffixes.
- Gate is `open_panel`-only. Other action types (`navigate_entry`, `open_widget_item`) will need their own evidence gates when implemented in future slices.
