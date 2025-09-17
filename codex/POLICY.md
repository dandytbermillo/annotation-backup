# Operating Policy — Codex CLI

Effective Immediately
- Read-only advisory mode. I only read/analyze and propose changes as patch previews. I never modify files or run write commands unless explicitly approved.
- Allowed write scope (codex): Only inside `codex/` and only after the user says “Approved” or “Implement now”.
- Allowed write scope (Live Context): Inside `.context-memory/` writes are permitted per user authorization; never include secrets/PII.
- Allowed read scope: Always allowed to read `.context-memory/` and `codex/`; other paths require explicit approval.
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
- Mandatory pre-read for ANY fix or change: always read `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` before proposing or implementing any fix, change, or suggestion, regardless of scope. Cite the relevant bullets (or note non‑applicability) and confirm compliance in your plan.
- Stay within `codex/` unless explicitly allowed to read outside.

Pre‑work Checklist (Must Affirm Before Starting)
1) Read `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` and record whether its constraints apply to this task (applicable or not applicable). Always acknowledge it in your plan.
2) If applicable (e.g., isolation/minimap/reactivity or analogous patterns), state concretely how your approach avoids the documented anti‑patterns (no provider/consumer drift, no UI‑only gating, no unguarded new hooks, no coupled behavioral changes).
3) If any anti‑pattern would be triggered, stop and request guidance before proposing fixes.

Live Context (carve-out)
- Scope: Assistant may write within `.context-memory/` without additional approval (per user authorization). Keep `codex/` writes approval-required.
- Logging: Append significant actions as `note` lines to `.context-memory/live/journal.ndjson`.
- Refresh: After notable updates, run `.context-memory/scripts/summarize.js` to update `summary.md`.
- Safety: Never include secrets or PII; respect budgets in `.context-memory/live/README.md`. Use `live/lock` during multi-step writes and remove it afterward.

Ultra-compact variant
- Default to read-only. No writes/patches/installs. Propose diffs; wait for approval.

# Authoritative User Policy (Verbatim)

- Operate in read-only advisory mode: do not modify files or run write commands; only read/analyze and propose changes, and wait for my explicit approval before any edits.
- Feature flags: ship newly implemented features enabled by default. Any temporary gating is allowed only for short verification windows with a documented removal timeline.

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
 - Allowed write scopes:
   - `.context-memory/` (always, per user authorization recorded in Live Context)
   - `/Users/dandy/Downloads/annotation_project/annotation-backup/codex` (only after explicit approval)

Interpretation update: In addition to the codex path above, `.context-memory/` is an approved write scope for the assistant and does not require per-action approval.

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
