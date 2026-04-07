# Plan: Command Typo Handling (Phased, Lightweight)

## Goal
Reduce intent parsing failures caused by simple typos in command keywords (e.g., "quik links") without touching user-provided entity names.

## Why a Phased Plan
For a small intent set, heavy fuzzy matching can be overkill. Most teams start with prompt guidance and measure impact, then add a minimal typo map if needed. This plan follows that path and adds guardrails to avoid wrong intents.

## Core Safety Rules (All Phases)
- Only normalize inside the **command slot** (start of message / before entity name).
- Never modify workspace or note names.
- Never modify text inside quotes (single or double).
- If correction is ambiguous, do not auto-correct. Ask or fall back to LLM unchanged.

---

## Phase 1 (Quick Win, Experimental): Prompt Tolerance ✅ COMPLETE

**Status**: Implemented and tested on 2024-12-31

Update the intent prompt to explicitly allow minor typos for **command phrases** only, with clear boundaries.

Add to prompt rules:
- "Only treat typos as command keywords when they appear in the command slot. Do not reinterpret words inside quotes or after rename/open targets."

Add examples (2–3):
- "quik links" → show_quick_links
- "workspces" → list_workspaces
- "dashbord" → go_to_dashboard

Measure:
- Track parse failures AND false positives (wrong intent) before/after.

If Phase 1 resolves most failures without new misfires, stop here.

### Implementation Details
- File modified: `lib/chat/intent-prompt.ts` (lines 163-175)
- Added "Typo Tolerance" section with examples and safety rules

### Test Results (8/9 passed = 89%)
| Input | Expected | Result |
|-------|----------|--------|
| `workspces` | list_workspaces | ✅ PASS |
| `kwick links` | show_quick_links | ✅ PASS |
| `quicklink` | show_quick_links | ✅ PASS |
| `open recnt workspace` | open_recent_workspace | ✅ PASS |
| `goto home` | go_home | ✅ PASS |
| `dashboard` | go_to_dashboard | ✅ PASS |
| `summary14` | resolve_name | ✅ PASS |
| `rename "Quik Links" to X` | No correction (quoted) | ✅ PASS |
| `√dashbord` | go_to_dashboard | ❌ FAIL (special char prefix) |

### Conclusion
Phase 1 sufficient for current needs. Phase 2 not required unless new edge cases emerge.

---

## Phase 2 (Recommended if Phase 1 isn’t enough): Tiny Typo Dictionary
Add a minimal, deterministic correction map for **canonical command patterns** (not individual tokens).

### Canonical Command Patterns
Examples (exact phrases or fixed prefixes):
- quick links
- list workspaces
- open workspace
- open recent workspace
- dashboard / go to dashboard
- home / go home
- rename <entity> to <entity>
- delete <entity>

### Typo Map (Examples)
- quik links → quick links
- quicklinks → quick links
- workspces → list workspaces
- dashbord → dashboard
- recnt workspace → open recent workspace

Rules:
- Apply corrections only to the command-slot prefix.
- Only apply when the typo map yields a single unambiguous target.
- If a phrase could map to multiple patterns, do not auto-correct.

### Retry Behavior (Optional)
If parsing fails and a correction exists, retry once using the corrected command phrase.

---

## Phase 3 (Future Only): Heuristic/Fuzzy Matching
Only if Phase 2 is insufficient.
- Add fuzzy matching with high thresholds and ambiguity checks.
- Use n-grams limited to the command slot.
- Require a clear best match before auto-correcting.

---

## Integration Point
Prefer server-side normalization in `app/api/chat/navigate/route.ts` so behavior is consistent across clients and only affects LLM input.

Optional UI hint:
- “Interpreting ‘quik links’ as ‘quick links’.”

---

## Observability
Log structured fields to measure impact:
- raw_text
- normalized_text (or normalized_command_phrase)
- applied_rule (map key)
- confidence (for deterministic map: 1.0)
- retry_used (boolean)

---

## Testing Checklist
- “quik links” → show quick links
- “quick links” → show quick links
- “workspces” → list workspaces
- “workspace 4” → open workspace (no list)
- “rename "Quik Links" to X” → no correction (quoted)
- “open recnt workspace” → open recent workspace

Edge cases:
- “delete quick links” → clarification (delete note vs open quick links)
- “open dashboard” → treat as go_to_dashboard unless quoted
- “dash” / “homee” → no correction unless explicitly mapped

---

## Rollback
Disable normalization and retry logic; send raw text to the LLM.

## Success Criteria
- Fewer “Failed to parse LLM response” errors on common typos.
- No mis-corrections of user-provided entity names.
- No increase in wrong-intent outcomes (tracked via logs).
