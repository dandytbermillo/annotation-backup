# Assistant Chat Commands — Previous Sessions

No shell required. Type these in chat; I will respond read-only and propose any edits for approval.

- Resume context
  - “Resume from RESUME.md” (preferred)
  - “resume” / “resume resume.md” / “resume RESUME”
  - I read `codex/previous-sessions/RESUME.md`, summarize latest exec/session, list Next steps.

- Refresh pointers
  - “Refresh RESUME.md” / “Refresh RESUME”
  - I read current files and propose a patch updating `RESUME.md` (Next steps + recent patches). You say “Approved” to save.

- Read docs
  - “resume readme.md” / “resume readme” → I summarize `codex/previous-sessions/README.md`.
  - “open guide.md” / “show guide” → I summarize `codex/previous-sessions/GUIDE.md`.
  - “show commands” → I summarize this COMMANDS.md.

- Refresh README
  - “Refresh readme.md” → I re-read `codex/previous-sessions/README.md` and summarize its current content.

- Start/continue a session (docs only; no writes without approval)
  - “Start session YYYY-MM-DD 'Title'” → I propose the two summary files + changelog entry; you approve to save.
  - “Append these logs to today” + paste logs → I propose an edit to today’s session summary; you approve to save.

- Propose patches (read-only)
  - “Draft patch preview for X” → I read and propose diffs. You approve to save under `codex/patches/`.

Notes
- I never write or install without explicit “Approved” (and only inside `codex/`).
- I auto-read `POLICY.md` and `RESUME.md` at startup to honor your workflow.

- End session
  - “End session” → I propose the closing checklist: Refresh RESUME, Refresh README, and summarize changes. You say “Approved” to save; I then mark “README Summary: fresh” in RESUME.md.
