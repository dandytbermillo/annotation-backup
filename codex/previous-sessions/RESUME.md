# Resume Here

> Open latest session summary: codex/previous-sessions/2025-09-01-session-summary.md

## Quick Status: Tooltips (2025-09-09)
- Mode: Option A (plain, no Yjs). Hover tooltips now read branch-first and never display raw JSON.
- Empty-state: Brand‑new annotations with no panel content show “No notes added yet” (no “Loading notes…” text).
- Consistency: Same title behavior across cases; original annotated text may appear in the title but not in the body.

## Changes Applied This Session
- Plain tooltip (`components/canvas/annotation-decorations-plain.ts`)
  - Preview precedence standardized to: stripHTML(branch.content) → provider/doc text (JSON-aware) → placeholder.
  - Removed originalText from preview body; kept in title context only.
  - Initial hover always renders via `renderPreview(...)` so empty shows “No notes added yet”.
  - Added delayed re-check of `canvasDataStore` and guarded API/doc fallbacks; kept async guards via `dataset.branchId`.
- Yjs tooltip (`components/canvas/annotation-decorations.ts`)
  - Aligned behavior for parity: show “No notes added yet” when brand‑new and empty; never use originalText in body.
  - Note: Option A path does not import/use Yjs; this parity is defensive for non‑plain runs.

## Proposal Patches (codex/proposal)
- `tooltip-unified-branch-first.patch`: unify preview precedence in both paths (branch-first with safe fallbacks).
- `option-a-tooltip-branch-first.patch`: plain‑mode branch‑first preview (earlier draft).
- Optional hardening (not applied): enforce plain as fail‑closed default and warn if any Yjs import occurs in plain.

## Verification Notes
- Ensure `NEXT_PUBLIC_COLLAB_MODE=plain` (or `localStorage.collab-mode="plain"`) during dev.
- Console should show: “📝 Using Plain Mode (no collaboration)” and `[getPlainProvider] Called. COLLAB_MODE: plain`.
- Manual checks:
  - Hover old and new annotations: body shows branch snippet or “No notes added yet”; never raw JSON.
  - After adding panel content, hover updates to the stripped snippet.

## Recent Messages (summary)
- User: Hover shows raw text/JSON for new vs existing annotations after applying guardrails patch.
- Assistant: Cause was provider‑doc‑first preview; proposed branch‑first + JSON parsing.
- User: Provide a patch; save to `codex/proposal`.
- Assistant: Added unified proposal; later applied targeted changes to plain path; removed originalText from body; fixed initial empty state.
- User: Works, but wants “No notes added yet” instead of “Loading notes…” for brand‑new annotations; apply also for Yjs parity.
- Assistant: Updated both paths; confirmed no “Loading notes…” and no originalText in body.

## Next Steps
- Optional: add a small guard to default to plain if env flag is missing, and log a visible warning if any Yjs import occurs in plain mode. Keep as proposal unless approved.
- Consider adding a lightweight unit test around preview selection to prevent regressions (branch content vs provider doc vs placeholder).

## Quick Status: Context‑OS (2025-09-05)
- Interactive INITIAL.md (Days 1–3): PASS with minor validator issues.
- Core components present: init-interactive CLI, Handlebars template + renderer, Claude mock adapter (invokeClaudeInit), session persistence (.tmp/initial), telemetry (logs/init-telemetry.jsonl).
- Known issues: validator expects Title as a section (template uses metadata); Acceptance Criteria key normalization bug in scripts/validate-initial-sections.js.
- Next steps: fix validator config/keys; optional aliases (--init-only/--resume-initial); run post-apply doc validator in init flow.

## Previous Session Summary
- Guide contradictions resolved: “ACTIVE RULES vs DEPRECATED” banner added to the Documentation Process Guide; verified after initial timing mismatch.
- Severity definitions: Agreed to adopt objective thresholds (10/25/50%) with environment multipliers; security remains Critical.
- Commands/aliases: Documented “Resume from readme.md”, “Start new session”, and “refresh resume”; defined resume output format (summary + last 3–4 messages).
- RESUME structure: Added Summary + Recent Messages sections to persist prior conversation context.

## Recent Messages (verbatim)
1) user: so you need to update the "refresh from resume.md" for the "resume from resume.md" to work well like this?
2) codex: Yes. To reliably show “summary + last 3–4 raw messages” when you say “Resume from RESUME.md”, the Refresh RESUME.md flow should persist those last messages. What to change… Want me to draft a small patch preview…?
3) user: yes
4) codex: Added a patch preview to document and support your desired behavior. What I added… Want me to apply this patch now and then update RESUME.md with the latest 3–4 messages?

- Operating Mode: Read-only advisory. Writes allowed only in `codex/` with explicit approval.
 - README Summary: fresh

- Latest summaries:
  - Executive: codex/previous-sessions/2025-09-01-exec-summary.md
  - Session: codex/previous-sessions/2025-09-01-session-summary.md

- Next steps:
 - If desired, approve implementing the above API and adapter hardening patches.
 - Keep the two blocks above current: update “Previous Session Summary” and “Recent Messages (verbatim)” during refresh/end-session
 - Decide on docs fix for contradictory rules (Item 2):
   - Minimal: apply `codex/patches/2025-09-02-doc-guide-lite-active-deprecated.patch` to add an "ACTIVE RULES vs DEPRECATED" banner (2-hour fix)
   - Or merged: apply `codex/patches/2025-09-02-item2-merged-proposal.patch` to add the comprehensive proposal doc
 - Consider applying `codex/patches/2025-09-02-refresh-readme.patch` to update the top-level README with TL;DR and links
 - Generate Phase 3 report/test scaffolding under `docs/proposal/unified_offline_foundation/` (as previews in `codex/` for review).
 - Use `codex/scripts/bench-api.sh` to baseline API timings pre/post changes.
 - Surface AGENTS.md in PRs (add PR template referencing AGENTS.md and codex/POLICY.md).
 - Note: `codex/POLICY.md` and `codex/previous-sessions/COMMANDS.md` updated with chat aliases (e.g., "Start new session", "Resume from readme.md")

- Recent patches added:
 - codex/patches/0001-api-queue-flush-parity.patch
 - codex/patches/0001b-api-queue-flush-dual-mode.patch
 - codex/patches/0002-import-response-skipped.patch
 - codex/patches/0003-search-fuzzy-threshold.patch
 - codex/patches/0004-annotation-canvas-plain-mode-fix.patch
 - codex/patches/0005-connectivity-badge-flag-gating.patch
 - codex/patches/0006-telemetry-throttle.patch
 - codex/patches/0007-phase3-uuid-coercion-and-params-fix.patch
 - codex/patches/0008-context-versions-params-type-fix-not-applied.patch
 - codex/patches/0008-versions-params-type-fix-not-applied.patch
 - codex/patches/0009-next15-params-promise-consistency.patch
 - codex/patches/0010-phase3-test-compare-seed.patch
 - codex/patches/0010b-phase3-test-compare-robust.patch
 - codex/patches/0011-notes-explicit-id-insert.patch
 - codex/patches/0011b-notes-explicit-id-hardened.patch
 - codex/patches/0011c-notes-location-header.patch
 - codex/patches/2025-09-02-doc-guide-lite-active-deprecated.patch
 - codex/patches/2025-09-02-item2-merged-proposal.patch
 - codex/patches/2025-09-02-doc-guide-v1.4-section4-alignment.patch
 - codex/patches/2025-09-02-docs-guide-v1.4-path-consistency.patch
 - codex/patches/2025-09-02-refresh-readme.patch

- Tips:
  - Run `codex/scripts/bench-api.sh` to baseline key endpoints.
  - Say “Refresh readme.md” to update README with today’s summary.

Updated by `codex/scripts/refresh-resume.sh`.
