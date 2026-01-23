# Chat Plans Status

This index keeps all chat plans available on disk, but clarifies which plans are current vs. superseded.
Status notes are based on the latest reports/tests; adjust if anything changed.

## Active / Current
- `llm-layered-chat-experience-plan.md` — **Current umbrella plan** (implemented 2026-01-06).
- `pending-options-message-source-plan.md` — Implemented; still relevant for options-as-source-of-truth.
- `pending-options-explicit-command-bypass.md` — Implemented; still relevant to avoid blocking explicit commands.
- `pending-options-reshow-grace-window.md` — Implemented; still relevant for re-showing options.
- `quick-links-generic-disambiguation-fix.md` — **Superseded** by `meta/link-notes-generic-disambiguation-fix.md` (implemented 2026-01-22).
- `pending-options-resilience-fix.md` — **Implemented** (2026-01-22) (improves resilience after typos/off-list input).

## Implemented (Keep for Reference)
- `session-query-routing-plan.md` — Implemented; keep as reference (requested to retain).
- `request-history-plan.md` — Implemented; request history tracking.
- `dynamic-typo-suggestions-plan.md` — Implemented; dynamic vocab.
- `dynamic-typo-suggestions-fixes-plan.md` — Implemented; fixes for recent/badges.
- `typo-suggestion-fallback-plan.md` — Implemented baseline.
- `suggestion-rejection-handling-plan.md` — Implemented.
- `suggestion-fallback-polish-plan.md` — Implemented.
- `suggestion-confirm-yes-plan.md` — Implemented.
- `pending-options-guard-plan.md` — Implemented baseline guard.
- `pending-options-reshow-plan.md` — Superseded by `pending-options-reshow-grace-window.md` (kept for history).
- `verify-query-verb-guard-plan.md` — Implemented (verify query bypass).

## Superseded (Use Current Umbrella Plan Instead)
- `llm-context-retrieval-general-answers-plan.md` — Superseded by `llm-layered-chat-experience-plan.md`.
- `llm-chat-context-first-plan.md` — Superseded by `llm-layered-chat-experience-plan.md`.
- `answer-from-chat-context-plan.md` — Superseded by `llm-layered-chat-experience-plan.md`.

## Reports (Evidence)
- `session_query_routing_plan_report/2025-01-04-implementation-report.md`
- `request_history_plan_report/2026-01-04-implementation-report.md`
- `dynamic_typo_suggestions_plan_report/2026-01-05-implementation-report.md`
- `suggestion_rejection_handling_plan_report/2026-01-05-implementation-report.md`
- `llm_context_retrieval_general_answers_plan_report/2026-01-05-implementation-report.md`
- `llm_layered_chat_experience_plan_report/2026-01-06-implementation-report.md`

