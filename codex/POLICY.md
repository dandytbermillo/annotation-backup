# Operating Policy — Codex CLI

Effective Immediately
- Read-only advisory mode. I only read/analyze and propose changes as patch previews. I never modify files or run write commands unless explicitly approved.
- Allowed write scope: Only inside `codex/` and only after the user says “Approved” or “Implement now”.
- Allowed read scope: Only inside `codex/` by default; reading outside requires explicit approval.
- Safe reads only: Use `rg`, `ls`, `sed -n`, `cat`, `head`. No installs, no destructive commands.
- Network: Restricted unless explicitly approved.
- Confirmation flow:
  - Assistant: “Read-only mode. Propose changes only.”
  - User: “I recommend editing file X. Patch preview below. Approve to apply?”
  - Assistant: “Approved: apply the patch.”
  - User: “Applying patch now…”
- Never proceed with edits unless the user explicitly says “Approved” or “Implement now”.

Startup Defaults
- Auto-read `codex/previous-sessions/RESUME.md` to rehydrate context.
- Auto-read this policy (`codex/POLICY.md`) to confirm guardrails.
- Stay within `codex/` unless explicitly allowed to read outside.

Ultra-compact variant
- Default to read-only. No writes/patches/installs. Propose diffs; wait for approval.

# Authoritative User Policy (Verbatim)

- Operate in read-only advisory mode: do not modify files or run write commands; only read/analyze and propose changes, and wait for my explicit approval before any edits.

Stronger template (recommended)

- Read-only mode:
    - Do not use apply_patch or any write/modify shell commands.
    - Only run safe read commands (e.g., rg, ls, sed -n, cat, head).
    - Do not create/rename/delete files or install packages.
    - Propose changes as a patch preview in text and ask for approval first.
    - Never proceed with edits unless I explicitly say “Approved” or “Implement now”.

Ultra-compact variant

- Default to read-only. No writes/patches/installs. Propose diffs; wait for my approval before any changes.

Example confirmation flow

- You: “Read-only mode. Propose changes only.”
- Me: “I recommend editing file X. Patch preview below. Approve to apply?”
- You: “Approved: apply the patch.”
- Me: “Applying patch now…”

Note:
 - the only folder you are allowed to read,write or delete or any modification - /Users/dandy/Downloads/annotation_project/annotation-backup/codex

Interpretation: “Do not use apply_patch” means by default; apply_patch may be used only after explicit approval and only within the codex path above.

Supported Chat Commands
- Resume: “Resume from RESUME.md”, “resume”
- Resume (alias): “Resume from readme.md” → retrieve/summarize previous session context from `codex/previous-sessions/RESUME.md` (or specified file) and report last conversation + next steps
- Refresh RESUME: “Refresh RESUME.md”, “Refresh resume”
- Read docs: “resume readme.md”, “open guide.md”, “show commands”
- Refresh README: “Refresh readme.md”
- Start session: “Start session YYYY-MM-DD 'Title'” (I propose files; you approve)
- Start session (alias): “Start new session”, “Start session” → equivalent to `codex/scripts/new-session.sh` (I propose files; you approve)
- Append logs: “Append these logs to today: …”
- Draft patches: “Draft patch preview for X” (I propose diffs; you approve)

Resume output format
- Summary (top): 3–6 bullets covering purpose, key decisions, approvals, and next steps
- Recent messages (verbatim): show the last 3–4 messages from the previous conversation, unsummarized
- Pointers: link to the latest `YYYY-MM-DD-session-summary.md` and `YYYY-MM-DD-exec-summary.md` if present

Closing reminders
- When you say “End session”, I will remind you to Refresh RESUME and Refresh README, and propose both updates for approval.
