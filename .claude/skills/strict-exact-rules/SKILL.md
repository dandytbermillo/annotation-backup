---
name: strict-exact-rules
description: Enforce strict exact implementation rules for deterministic execution, routing order, provenance, and candidate scoping. Use when implementing or reviewing routing, execution, or disambiguation code.
---

# Strict Exact Implementation Rules

You MUST follow these rules for all implementation work in this session. These are non-negotiable governance constraints.

## Core Contract
1. Not exact => never deterministic execute.
2. All non-exact => bounded LLM -> safe clarifier.
3. Deterministic provenance (`deterministic`) is allowed only for strict exact paths.
4. Explicit scope cues (`from dashboard/workspace/widget/chat`) constrain candidate domain only; they never authorize deterministic execution by themselves.

## Exact Means (Authoritative)
- Strict label: `rawInput.trim().toLowerCase() === label.trim().toLowerCase()`
- Strict sublabel: same as label check against sublabel.
- Strict whole-string ordinal only (no embedded extraction in longer phrases).
- Optional badge letter only when explicitly enabled and anchored to one token (e.g. `a`-`e`).

## Forbidden for Deterministic Execution
- Verb stripping / polite-prefix stripping.
- Canonical token matching.
- Token-subset matching.
- Fuzzy/Levenshtein matching.
- `contains`, `startsWith`, partial phrase matching.
- Embedded ordinal extraction from longer text.

## Routing Order (Required)
1. Try strict deterministic checks only.
2. If not exact, build bounded candidate scope by domain evidence (active clarification first, then panel evidence, then widget fallback).
3. Run bounded LLM with scoped candidates.
4. If unresolved/low confidence, safe clarifier.
5. Scoped single-match but non-exact input is still non-exact: do not auto-execute deterministically.

## Candidate Scope Rules
- Candidate scope quality is part of correctness: wrong scope makes LLM outputs unreliable.
- Domain evidence may use normalization only as advisory candidate discovery, never as deterministic authorization.
- Do not let generic widget/reference branches preempt stronger panel/active clarification evidence.
- If a declared scope cannot be safely filtered yet (for example incomplete workspace candidate pool), keep scope-specific hard-stop clarifier; never passthrough to mixed-domain routing.

## Provenance Rules
- `deterministic`: strict exact deterministic only.
- `llm_executed`: LLM selected and action executed.
- `llm_influenced`: LLM asked clarifier/reordered options or influenced outcome without direct deterministic match.
- `safe_clarifier`: explicit safe fallback.
- Never default unknown provenance to `deterministic`.

## Regression Checklist (Must Pass)
- Non-exact command forms never return deterministic handled=true from deterministic branches.
- Repeated noisy forms (greetings, polite tails, punctuation variants) keep same domain scope.
- `??` or extra filler words do not divert routing domain unexpectedly.
- Active clarification responses prefer active options over unrelated widget lists.
- LLM-disabled path: non-exact always ends in safe clarifier (no silent drop/fallthrough).

## Code Review Guardrails
- Any new `handled: true` path must prove strict exact input source.
- Any call to deterministic resolver must use raw input, not rewritten input.
- Any normalization helper usage must be labeled advisory-only.
- Any early return before bounded LLM must be exact-only.

## Enforcement
When writing or reviewing code, verify EVERY deterministic execution path against these rules. If you find a violation, flag it immediately and do not proceed until it is corrected.
