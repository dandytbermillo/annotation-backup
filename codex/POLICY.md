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

