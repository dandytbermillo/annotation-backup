# Known vs Docs Routing General Plan

**Status:** Active reference  
**Owner:** Chat Navigation  
**Scope:** Canonical decision rules for when input should execute known-noun command routing vs doc/informational routing.

## Purpose
- Freeze a single, testable ruleset for `known-noun` (Tier 4) and `docs` (Tier 5).
- Reduce drift across implementation reports and partial fixes.
- Keep command execution deterministic and docs retrieval as last resort.

## Canonical Tier Boundary
1. Tier 4 (`known-noun`) runs before docs.
2. Tier 5 (`doc retrieval`) runs only when higher tiers decline.
3. Tier 4.5 (`grounding-set`) remains between Tier 4 and Tier 5.
4. Tier 4.6 widget-context questions may bypass Tier 5 and fall through to API payload handling.

## Tier 4 Rules (Known-Noun)
Order is strict:
1. Known noun with trailing `?` only:
- Show `Open X, or read docs?` clarification.
2. Full question framing about noun:
- Return unhandled so Tier 5 docs can answer.
3. Exact known-noun match:
- Execute open-panel command.
4. Near match (fuzzy):
- Show `Did you mean ...?` prompt.
5. Unknown short noun-like input:
- Show unknown fallback message.
- If visible widget list exists, bypass unknown fallback and let Tier 4.5 try list matching.

Command execution invariants:
1. Opening a known noun clears stale selection state:
- `pendingOptions`
- `activeOptionSetId`
- `lastClarification`
- `lastOptionsShown`
- `clarificationSnapshot`
- widget selection context
2. Known command must not be trapped by selection retry logic.

## Tier 5 Rules (Docs / Informational)
Tier 5 is entered only after Tier 4 and Tier 4.5 decline.

Primary route classification:
1. `action`:
- Return unhandled (do not retrieve docs here).
2. `doc`:
- Retrieve docs.
3. `bare_noun`:
- Retrieve docs under bare-noun guard.
4. `clarify_ambiguous`:
- Show app-vs-other clarification.
5. `llm`:
- Do not retrieve docs.

Doc routing guardrails:
1. Command-like and panel-like inputs are action route, not docs.
2. Question-intent and doc-verb phrasing may route to docs if app-relevant.
3. High-ambiguity terms must clarify before docs retrieval.

## Pre-Tier Guards Affecting Known vs Docs
These run earlier and must preserve the boundary:
1. Cross-corpus handler skips command-like and visible-panel command inputs.
2. Selection-context guards may bypass cross-corpus when input is selection-like.
3. Explicit command escape in selection resolver must allow known-noun command to reach Tier 4.

## Widget Context Question Bypass (Tier 4.6)
For inputs like `what does this widget mean?`:
1. If visible widget context segments exist, skip Tier 5 docs.
2. Return passthrough so API request uses widget context payload.

## Source of Truth Policy
1. This file is the canonical policy for known-vs-doc routing decisions.
2. Implementation reports are historical evidence, not policy.
3. If code behavior changes, update this file in the same change set.

## Acceptance Checks
1. `open links panel d` executes Tier 4 known-noun command, not docs.
2. `links panel?` shows `Open or docs` clarification.
3. `what is links panel?` skips Tier 4 execution and routes to docs behavior.
4. Unknown noun with no widget list shows unknown fallback.
5. Unknown noun with visible widget list bypasses unknown fallback and allows Tier 4.5 matching.
6. `what does this widget mean?` with widget context bypasses docs and uses API passthrough.
7. Command-like input during active selection context still escapes to Tier 4 when resolvable.

## Non-Goals
1. This plan does not redefine Tier 3 chat clarification behavior.
2. This plan does not redefine cross-corpus ranking/scoring.
3. This plan does not redefine grounding-set candidate construction logic.

## Pre-Read Compliance
- `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` reviewed.
- Applicability: not directly applicable to this document-only routing policy plan.
- Compliance: no provider/consumer API changes or reactivity hook changes are introduced here.
