# Option A — Image Handling via UI Attachment Resolution (No Context‑OS Changes)

Status: Proposal — Ready to Adopt
Owner: Platform/Bridge + Docs
Last updated: 2025‑09‑07

## Objectives
- Let users add screenshots alongside slash commands (e.g., `/context-fix`) without pushing raw image bytes through CLI flags.
- Keep CLIs as the single JSON boundary; keep Router/Bridge responsible for pre‑flight, envelopes, and telemetry.
- Preserve determinism and CI parity via file/URL references and JSON input.

## Summary (How It Works)
- In Claude Code (chat UI): Users type the command and paste screenshots in the same message (e.g., `--images @1 @2`). The UI captures attachments, resolves placeholders to URLs/paths, optionally enriches text/metrics with vision, then calls Context‑OS with one JSON envelope.
- In CI/terminal: Users cannot “paste” images. They pass resolvable file paths/URLs in the issue text or via the JSON CLI.
- No Context‑OS code changes required.

## UX Scenarios
- Chat UI
  - User: `/context-fix --feature dark_mode --issue "Button broken" --images @1 @2` (two screenshots attached)
  - UI: Captures attachments, assigns IDs, resolves `@1/@2` to URLs/paths, optionally enriches issue/metrics via vision.
  - Tool call payload (example):
    ```json
    {
      "feature": "dark_mode",
      "issue": "Button broken on mobile; overlapping text; contrast ~1.3:1",
      "metrics": { "usersAffected": 60, "performanceDegradation": 30 },
      "environment": "staging",
      "images": [
        { "mediaType": "image/png", "path": "./docs/proposal/dark_mode/implementation-details/artifacts/mobile-375.png" },
        { "mediaType": "image/png", "path": "https://cdn.example/att-2.png" }
      ]
    }
    ```
- CI/Terminal
  - JSON CLI (recommended):
    ```bash
    echo '{
      "feature":"dark_mode",
      "issue":"Overlap on 375px. ![screen](./docs/proposal/dark_mode/implementation-details/artifacts/375.png)",
      "metrics":{"usersAffected":60},
      "environment":"staging",
      "images":["./docs/proposal/dark_mode/implementation-details/artifacts/375.png"],
      "dryRun":false,
      "autoConfirm":true
    }' | node context-os/cli/fix-cli.js
    ```

## Router/Bridge Pre‑Flight (UI/Harness Layer)
Add these guardrails before invoking Context‑OS (no changes inside Context‑OS):
- detectComposerImages(): Capture attachments visible in the composer → returns a manifest `[ { id, name, mime, size, url|path } ]`.
- resolveImagesFlag(): If the command text includes tokens (e.g., `@1 @2`) or a `--files` flag, map them to the manifest/paths.
- Manifest > placeholders policy: If attachments exist but tokens are missing/edited, use all visible attachments (order‑of‑appearance) and emit a friendly warning.
- Attachment presence check:
  - If tokens are present but `imagesCaptured === 0` → block the call with clear guidance and examples for `--files`/JSON.
- Bounded retries: On upload/resolve failures, retry with backoff (e.g., 500ms → 1500ms) up to a small cap; then block with guidance.
- Envelope assembly: Build the single JSON envelope your CLIs already expect, optionally including `images: []` and listing any persisted files in `artifacts: []`.

## Envelope Schema (No Behavior Change to Agents)
- Keep your standard envelope and add optional fields:
  ```ts
  type ImageRef = {
    mediaType: string;         // image/png, image/jpeg, image/webp, etc.
    path?: string;             // repo‑relative path or URL (preferred)
    // data?: string;          // optional base64 if you must embed (avoid when possible)
  };

  type Envelope = {
    ok?: boolean;              // as used today by CLIs
    command: string;           // e.g., "fix"
    feature?: string;
    issue?: string;
    metrics?: { usersAffected?: number; performanceDegradation?: number; [k: string]: unknown };
    environment?: string;
    images?: ImageRef[];       // optional attachments resolved by UI/harness
    artifacts?: string[];      // file paths persisted by downstream tools
    result?: unknown;
    error?: string;
    logs?: string[];
  };
  ```
- Prefer `path` (URLs or repo‑relative paths). Avoid base64 in envelopes for size/logging reasons.

## Telemetry Additions (UI/Harness Layer)
- Add counters to existing telemetry events:
  - `imagesCaptured`: number (composer + `--files`)
  - `imagesBound`: number (actually included in the envelope)
- Keep existing fields (`command`, `route`, `duration`, `exitStatus`, `artifacts`, `tokenEstimate`).
- Privacy (default): Log counts-only by default. Do not log image URLs/paths unless an explicit allow flag/config is enabled (and never in production if policy forbids). If paths must be logged for debugging, hash or redact.

## Security & Limits
- Accept only `http(s)` URLs and repo‑relative paths.
- Enforce caps via UI/harness:
  - Max images per call (e.g., 5)
  - Max size (e.g., 5MB each)
  - Allowed types: png, jpg, jpeg, webp, gif
- Sanitize any user‑provided paths/URLs; reject absolute system paths.

### URL Lifetime / Authorization
- Prefer repo‑relative paths for determinism.
- If URLs are used, require HTTPS, signed URLs with a minimum TTL (e.g., ≥ 1 hour), and no PII in query params.
- Surface 403/expired as a friendly, actionable error with deterministic fallbacks.

## Docs/Help Updates (No Code Changes)
- `.claude/commands/context-fix.md` — add “Visual Issue Support”:
  - “Attach screenshots before sending (UI binds them automatically), or pass resolvable paths/URLs via JSON/`--files`. Removing images before sending means they won’t be processed.”
- `SLASH_COMMANDS.md` / `BRIDGE.md` — show both flows:
  - Composer attachments (UI resolves)
  - Deterministic: `/context-fix …` with links in issue text or JSON `images: []`
- Optionally note that images included by the UI are listed as `artifacts` in telemetry (either references or counts, per privacy policy).

### Error UX (Microcopy)
- No attachments but tokens present: “No images detected. Attach screenshots or pass resolvable paths/URLs via --files or JSON (images: []).”
- Tokens edited/mismatch: “Ignoring edited image tokens; using attached images in the order shown.”
- Upload/resolve failed after retries: “Couldn’t bind images. Use --files/JSON with resolvable paths/URLs.”

## Acceptance Criteria
- If tokens like `@1` appear but no attachments are captured → block with guidance and examples.
- If attachments exist but tokens are edited/missing → attachments win; warning shown.
- Images are bound in a stable order (order of appearance). Duplicate attachments are removed using content hash (e.g., SHA‑256) with a single warning (“Duplicate image ignored”).
- A single JSON envelope is always sent; `images[]` present when attachments/`--files` are used.
- Telemetry includes `imagesCaptured` and `imagesBound` counters.
- Context‑OS receives enriched text/metrics + links/paths (no raw bytes), and proceeds as today.

## Nice‑to‑Have Hardening
- MIME sniffing in addition to extension checks (png/jpg/webp/gif only).
- Signed URL host allowlist when URLs are used.
- Base64 embedding allowed only under strict size limits; redact from telemetry.

## Non‑Goals
- No raw image bytes through CLI flags.
- No changes to Context‑OS code paths are required for Option A.
- CI “pasting” is out‑of‑scope; CI should use file paths/URLs or JSON `images: []`.

## Rollout Plan
1) Enable UI/harness capture + resolution (tokens → manifest → URLs/paths) with retries and guardrails.
2) Add telemetry counters and friendly error messages.
3) Update command help/docs with the short “Visual Issue Support” notes.
4) Monitor `imagesCaptured` vs `imagesBound`; review failure rates and user friction.

## Examples
- Chat UI (with attachments):
  - User: `/context-fix --feature dark_mode --issue "Button broken" --images @1 @2` (2 screenshots attached)
  - UI → Context‑OS envelope:
    ```json
    {
      "feature":"dark_mode",
      "issue":"Button broken on mobile; overlapping text; contrast ~1.3:1",
      "metrics":{"usersAffected":60,"performanceDegradation":30},
      "environment":"staging",
      "images":[{"mediaType":"image/png","path":"https://blob/att-1.png"},{"mediaType":"image/png","path":"https://blob/att-2.png"}]
    }
    ```
- CI JSON (deterministic):
  ```bash
  echo '{
    "feature":"dark_mode",
    "issue":"Overlap at 375px. ![375](./docs/proposal/dark_mode/implementation-details/artifacts/375.png)",
    "images":["./docs/proposal/dark_mode/implementation-details/artifacts/375.png"],
    "autoConfirm":true
  }' | node context-os/cli/fix-cli.js
  ```

## Open Questions
- Telemetry policy: Are image URLs permitted in logs, or should we record counts only?
- Docs placement: Do we want the “Visual Issue Support” note in CLAUDE_NATIVE_AGENT_PROPOSAL.md as well, or just command help + BRIDGE?
- Future: Do we want a first‑class CLI `--image/--files` flag later (Option B) for guaranteed “Visual Evidence” sections in docs?
