# Assistant Chat Commands — Previous Sessions

No shell required. Type these in chat; I will respond read-only and propose any edits for approval.

- Resume context
  - “Resume from RESUME.md” (preferred)
  - “resume” / “resume resume.md” / “resume RESUME”
  - I read `codex/previous-sessions/RESUME.md`, summarize latest exec/session, list Next steps.
  - Output format:
    1) Previous Session Summary (3–6 bullets)
    2) Last Messages (3–4 most recent messages, not summarized)
    3) Links to latest `YYYY-MM-DD-session-summary.md` and `YYYY-MM-DD-exec-summary.md`
  - Alias: “Resume from readme.md” → same behavior; reads RESUME.md by default unless a different file is specified

- Refresh pointers
  - “Refresh RESUME.md” / “Refresh RESUME” / “refresh resume”
  - I read current files and propose a patch updating `RESUME.md`:
    - Update “Previous Session Summary” (3–6 bullets)
    - Update “Recent Messages (verbatim)” with the last 3–4 messages (unsummarized)
    - Update “Next steps” and append recent patches
  - You say “Approved” to save.

- Read docs
  - “resume readme.md” / “resume readme” → I summarize `codex/previous-sessions/README.md`.
  - “open guide.md” / “show guide” → I summarize `codex/previous-sessions/GUIDE.md`.
  - “show commands” → I summarize this COMMANDS.md.

- Refresh README
  - “Refresh readme.md” → I re-read `codex/previous-sessions/README.md` and summarize its current content.

- Start/continue a session (docs only; no writes without approval)
  - “Start session YYYY-MM-DD 'Title'” → I propose the two summary files + changelog entry; you approve to save.
  - Aliases: “Start new session”, “Start session” → equivalent flow to `codex/scripts/new-session.sh` (assistant proposes; you approve to write in codex/)
  - “Append these logs to today” + paste logs → I propose an edit to today’s session summary; you approve to save.

- Propose patches (read-only)
  - “Draft patch preview for X” → I read and propose diffs. You approve to save under `codex/patches/`.

Notes
- I never write or install without explicit “Approved” (and only inside `codex/`).
- I auto-read `POLICY.md` and `RESUME.md` at startup to honor your workflow.

- End session
  - “End session” → I propose the closing checklist: Refresh RESUME (Summary + Recent Messages), Refresh README, and summarize changes. You say “Approved” to save; I then mark “README Summary: fresh” in RESUME.md.
