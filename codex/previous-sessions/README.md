# Previous Sessions Records — README

Purpose
- Capture concise, durable records of each working session to speed continuity, handoffs, and reviews.
- Provide two levels of artifacts:
  - Executive summary: 1-page, stakeholder-friendly snapshot (what changed, decisions, next steps).
  - Session summary: detailed notes (issues found, proposals, approvals, and suggested follow-ups).
- Maintain a running changelog for quick historical lookup.

Why Use This
- Continuity: New or returning contributors ramp in minutes without rescanning the repo.
- Accountability: Documents approvals and scope; clarifies what was proposed vs. implemented.
- Planning: Feeds sprint updates, PR descriptions, and test plans.
- Support & Triage: Shows recent changes, known gaps, and pending actions during incidents.
- Compliance: Creates an audit trail of decisions and feature-flag rollouts.

What’s Here
- `YYYY-MM-DD-session-summary.md`: Detailed session log.
- `YYYY-MM-DD-exec-summary.md`: Condensed stakeholder summary.
- `CHANGELOG.md`: Running index of sessions with brief bullets.

How To Use
- For Standups/Status: Copy bullets from the executive summary’s Key Artifacts/Next Steps.
- For PRs: Use the “Next Steps” and “Acceptance/Verify” bullets to prefill descriptions and test plans.
- For QA: Pull “Testing” and “Outstanding Recommendations” sections from the session summary.
- For Incident Review: Check the changelog to see the last applied vs. deferred items.
- For Planning: Link these files in Jira/Linear tickets for context.

Conventions
- Filenames: `YYYY-MM-DD-*.md` (UTC date).
- Tone: factual, concise, action-oriented. Avoid PII; do not include secrets.
- Scope: Summaries should reference only public repo paths and feature flags.
- Links: Prefer relative repo paths (e.g., `docs/...`, `app/api/...`).

Recommended Session Template
```
# Session Summary — YYYY-MM-DD

## Context
- Constraints/approvals
- Goals

## Actions & Findings
- Key scans/diagnostics
- Proposed changes (patch previews if applicable)

## Approvals & Constraints Observed
- What was approved vs. deferred

## Outstanding Recommendations
- List, with filepaths

## Next Suggested Steps
- Ordered, actionable list
```

Maintaining CHANGELOG
- Append a dated section with 4–6 bullets per session.
- Link to the day’s summaries for detail.
- Roll older months into `CHANGELOG-ARCHIVE/YYYY-MM.md` if it grows too large (optional).

Approval Workflow (Codex Context)
- Writes are restricted to `codex/` with explicit approval.
- Store all session records here; do not modify files outside `codex/` unless separately approved.

Best Practices
- Keep entries small and scannable; prefer bullets.
- Include concrete file paths and feature flags for traceability.
- Record deviations and rationale to ease future audits.

Examples
- See: `2025-09-01-session-summary.md`, `2025-09-01-exec-summary.md`, and `CHANGELOG.md` in this folder.

Further Reading
- See `GUIDE.md` for end-to-end workflows, script usage, and troubleshooting.

Chat Commands Quickstart
- Resume: say “Resume from RESUME.md” (or “resume”)
- Refresh RESUME: say “Refresh RESUME.md”
 - Read docs: say “resume readme.md” or “open guide.md”
 - Refresh README: say “Refresh readme.md”
- Full list: see `COMMANDS.md`

Recent Updates — 2025-09-02
- Added `COMMANDS.md` with supported chat phrases (resume/refresh/readme/end session).
- Updated `GUIDE.md` with no-shell Quick Start and end-of-session checklist.
- Expanded `POLICY.md` with Authoritative User Policy, supported commands, and closing reminders.
- Added `scripts/refresh-resume.sh` and wired `new-session.sh` to auto-refresh RESUME.
- Enhanced `RESUME.md` with Operating Mode and README Summary freshness marker.
- Saved patch previews: `0011b-notes-explicit-id-hardened.patch`, `0011c-notes-location-header.patch` (not applied to app code).
