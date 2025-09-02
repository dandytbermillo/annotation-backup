# Previous Sessions System — Operations Guide

Purpose
- Durable continuity: Persist context across restarts or handoffs without relying on chat history.
- Fast resume: One stable pointer file links the latest summaries and next steps.
- Auditability: Clear record of what was proposed, approved, and deferred.

What’s Included
- RESUME.md: Quick-start pointer to the latest exec/session summaries, next steps, and recent patches.
- YYYY-MM-DD-exec-summary.md: 1-page stakeholder snapshot (changes, decisions, next steps).
- YYYY-MM-DD-session-summary.md: Detailed log (findings, proposals, approvals, tests).
- CHANGELOG.md: Running index of sessions across time; brief bullets with links.
- Scripts:
  - codex/scripts/new-session.sh: Scaffolds daily summaries and updates CHANGELOG; auto-refreshes RESUME.md.
  - codex/scripts/refresh-resume.sh: Regenerates RESUME.md from latest summaries and patches.

Quick Start
- No shell required (chat):
  - Resume: say “Resume from RESUME.md”
  - Refresh pointers: say “Refresh RESUME.md”
  - Read docs: say “resume readme.md” or “open guide.md”
  - Refresh README summary: say “Refresh readme.md”
- Shell (optional):
  - Start new day: bash codex/scripts/new-session.sh 2025-09-01 "Optional Title"
  - Refresh pointers only: bash codex/scripts/refresh-resume.sh
  - Manual: open codex/previous-sessions/RESUME.md

Daily Workflow
- Start of day:
  - Chat: “Start session YYYY-MM-DD 'Title'” (I’ll propose the files; approve to save), or run new-session.sh.
  - Fill “Context” and initial “Next Suggested Steps” in session summary.
- During session:
  - Record approvals (“Approved: codex/patches/XXXX.patch”).
  - Paste key test logs and outcomes; link related files under codex/patches/.
- End of session:
  - Ensure “Outstanding Recommendations” and “Next Suggested Steps” are current.
  - Run refresh-resume.sh if needed (new-session.sh already runs it).
- After restart/crash:
  - Run refresh-resume.sh.
  - Open RESUME.md and follow “Next steps”.
  - Restate “Read-only mode” and re-approve any pending actions.

Approvals & Read-only Flow (Codex)
- Edits outside codex/ require explicit approval.
- Patches are proposed under codex/patches/ as previews; you respond “Approved” to save them.
- Summaries/RESUME live under codex/previous-sessions/ and are safe to create/update via scripts.

Assistant Chat Commands (no shell)
- Resume: “Resume from RESUME.md”, “resume”
- Refresh RESUME: “Refresh RESUME.md”
- Read docs: “resume readme.md”, “open guide.md”
- Refresh README: “Refresh readme.md”
- Start: “Start session YYYY-MM-DD 'Title'”
- Append logs: “Append these logs to today: …”
- See also: codex/previous-sessions/COMMANDS.md

Script Reference
- new-session.sh
  - Usage: bash codex/scripts/new-session.sh [YYYY-MM-DD] [optional-title]
  - Behavior:
    - Creates codex/previous-sessions/DATE-exec-summary.md if missing.
    - Creates codex/previous-sessions/DATE-session-summary.md if missing (pre-filled template; replaces “DATE” header).
    - Ensures codex/previous-sessions/CHANGELOG.md exists; appends a DATE section if missing.
    - Calls refresh-resume.sh at the end (if available).
  - Idempotent: Safe to run more than once; skips existing files.
- refresh-resume.sh
  - Usage: bash codex/scripts/refresh-resume.sh
  - Behavior:
    - Finds the latest exec/session summaries by filename.
    - Extracts “Next Suggested Steps” from the latest session summary.
    - Lists the 10 most recent patches in codex/patches/.
    - Regenerates codex/previous-sessions/RESUME.md with the above.

File Conventions
- Filenames: UTC date: YYYY-MM-DD-*.md
- Tone: concise, factual, action-oriented; no secrets/PII.
- Links: use repo-relative paths like app/api/..., codex/patches/....

Recommended Templates
- Executive Summary (DATE-exec-summary.md)
  - Scope: <brief scope of work>
  - Key Artifacts: <paths created/updated>
  - Noted Gaps (not applied): <bullets>
  - Next Steps: <ordered, actionable bullets>
- Session Summary (DATE-session-summary.md)
  - Context: constraints/approvals, goals
  - Actions & Findings: scans/diagnostics, proposals
  - Approvals & Constraints Observed: approved vs. deferred
  - Outstanding Recommendations: list with file paths
  - Next Suggested Steps: actionable list (this is pulled into RESUME.md)

Best Practices
- Always record approvals with exact patch paths.
- Include minimal but concrete test evidence (status codes, timings, key logs).
- Keep “Next Suggested Steps” current and specific.
- Use feature flags and file paths to anchor notes.

Troubleshooting
- RESUME.md not updating:
  - Run bash codex/scripts/refresh-resume.sh
  - Ensure latest session filename matches pattern *-session-summary.md
- Duplicate day entries in CHANGELOG:
  - new-session.sh guards against duplicates; verify date argument and time zone.
- “Latest” points to old files:
  - Confirm filenames sort correctly (YYYY-MM-DD format).
- Script perms:
  - Running via bash … works even if execute bit isn’t set.

Integration Tips
- Link exec/session summaries in PR descriptions for context.
- Copy “Next Steps” into sprint planning/issue trackers.
- Consider archiving older months into CHANGELOG-ARCHIVE/YYYY-MM.md to keep CHANGELOG concise.

End-of-session Checklist
- Refresh RESUME.md to capture latest Next Steps and recent patches.
- Refresh README.md summary so newcomers see current guidance.
- Ensure “Next Suggested Steps” in today’s session summary are up to date.
- (Optional) Commit or back up the codex/ folder.

FAQ
- Q: Does this depend on Codex being active?
  - A: No. Scripts and files are plain text; they work offline and outside Codex.
- Q: How do we recover after accidental termination?
  - A: Run refresh-resume.sh and open RESUME.md; resume from “Next steps”.
- Q: Can we tailor templates?
  - A: Yes—edit the templates here; scripts won’t overwrite existing files.

Glossary
- Exec Summary: One-page, stakeholder-focused snapshot.
- Session Summary: Detailed, engineer-focused log of a working session.
- RESUME.md: Stable pointer for rapid rehydration after restarts.
- Patch preview: A diff proposed under codex/patches/ awaiting approval.
