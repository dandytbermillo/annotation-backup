# Option A — Implementation Guide (UI/Bridge Only)

Status: Ready to implement (no Context‑OS changes)
Owners: Platform UI/Bridge, Docs
Date: 2025‑09‑07

## Scope
- Enable screenshots with slash commands (e.g., `/context-fix`) by resolving message attachments to paths/URLs at submit time.
- Keep CLIs as the single JSON boundary; send one envelope with optional `images[]` and list persisted paths under `artifacts[]`.
- No changes to Context‑OS code required.

## Responsibilities
- UI/Bridge (this doc):
  - Capture message attachments on submit
  - Resolve `--images @1 @2` tokens to the attachment manifest
  - Enforce guardrails + retries
  - Build the single JSON envelope (with privacy‑aware telemetry)
- Context‑OS:
  - Receives enriched text + metrics + image references and proceeds as today

## Pre‑Flight Hooks (Bridge)
- `detectComposerImages(): ImageManifest[]`
  - Reads images visible in the composer at submit
  - Returns: `[ { id, name, mime, size, url|path } ]`
- `resolveImagesFlag(input, manifest): ResolvedImage[]`
  - If `@n` tokens present → map to manifest indices
  - If tokens missing/edited but manifest has attachments → use all in order of appearance; warn once
  - If tokens present AND `manifest.length === 0` → block with guidance
- `persistIfNeeded(images): string[]`
  - Optional: for repo‑relative determism, persist blobs to `implementation-details/artifacts/` and return local paths
  - Otherwise use HTTPS signed URLs (≥1h TTL)

## Guardrails & Retries
- Block when `@n` present but no attachments captured
- Manifest > placeholders: attachments are authoritative; order‑of‑appearance wins
- Deduplicate by content hash (SHA‑256); warn once: "Duplicate image ignored"
- Bounded retries on upload/resolve: 2 attempts, 500ms → 1500ms backoff; then block with guidance

## Envelope Assembly
```ts
// Minimal shape (extend as needed; avoid base64 where possible)
interface ImageRef { mediaType: string; path?: string /* URL or repo‑relative */ }
interface Envelope {
  ok?: boolean
  command: string           // e.g., "fix"
  feature?: string
  issue?: string
  metrics?: { usersAffected?: number; performanceDegradation?: number; [k: string]: unknown }
  environment?: string
  images?: ImageRef[]       // resolved by UI/Bridge
  artifacts?: string[]      // any persisted files written by the harness
  result?: unknown
  error?: string
  logs?: string[]
}
```

## Telemetry (Bridge)
- Always emit: `command`, `route`, `duration`, `exitStatus`, `tokenEstimate`, `artifacts`.
- Add counters:
  - `imagesCaptured`: number (composer + `--files`).
  - `imagesBound`: number (actually included in the envelope).
- Privacy default: counts‑only (no URLs/paths) unless a non‑prod toggle is enabled; redact/hash paths if logged.

### Example (prod)
```json
{
  "timestamp": "2025-09-07T12:00:00Z",
  "sessionId": "abc123",
  "command": "/fix",
  "route": "hybrid",
  "duration": 2400,
  "exitStatus": "success",
  "tokenEstimate": 1200,
  "imagesCaptured": 2,
  "imagesBound": 2,
  "artifacts": ["docs/proposal/dark_mode/.../375.png"]
}
```

### Dashboards & Alerts
- Binding health: `imagesBound / imagesCaptured`.
- Watch tokens‑present + imagesCaptured=0 incidents.
- Retry outcomes vs degraded/blocked counts.
- Alerts: binding failure rate >5% (30m), tokens+zero‑attachments spike, degraded spikes when images expected.

## Limits & Security
- Max images per call: 5 (configurable)
- Max size per image: 5 MB
- Allowed types: png, jpg/jpeg, webp, gif (validate via MIME + extension)
- Accept repo‑relative paths or HTTPS signed URLs (≥1h TTL, no PII in query params)
- Reject absolute system paths

## Error Copy (Bridge/UI)
- No attachments but tokens present:
  - "No images detected. Attach screenshots or pass resolvable paths/URLs via --files or JSON (images: [])."
- Tokens edited/mismatch (attachments exist):
  - "Ignoring edited image tokens; using attached images in the order shown."
- Upload/resolve failed after retries:
  - "Couldn’t bind images. Use --files/JSON with resolvable paths/URLs."
- Duplicate image:
  - "Duplicate image ignored (same content)."

## Error UX (Bridge)
- No attachments but tokens present:
  - "No images detected. Attach screenshots or pass resolvable paths/URLs via --files or JSON (images: [])."
- Tokens edited/mismatch (attachments exist):
  - "Ignoring edited image tokens; using attached images in the order shown."
- Upload/resolve failed after retries:
  - "Couldn’t bind images. Use --files/JSON with resolvable paths/URLs."

## Acceptance Criteria
- If tokens appear but no attachments are captured → block with guidance
- If attachments exist but tokens are edited/missing → attachments win; warn once
- Images are bound by order of appearance; duplicates removed by content hash
- One JSON envelope is always sent; `images[]` present when attachments/`--files` are used
- Telemetry includes `imagesCaptured` and `imagesBound` counters (counts‑only by default)

## QA Plan (Staging)
### Tests
- Happy Path: 2 attachments + `--images @1 @2` → imagesBound=2; envelope images[] length=2; doc links present; exitStatus success.
- Tokens Without Attachments: tokens present, no attachments → block with guidance; no tool call.
- Edited Tokens: attachments present; remove tokens → attachments authoritative; warn once; bind in order; dedupe identical.
- Duplicate Images: attach same file twice → deduped by hash; warn once; imagesBound=1.
- Limits: >5 images or >5MB each → rejected pre‑flight with friendly error.
- CI JSON Path: JSON CLI with `images:["./path.png"]` → end‑to‑end success; doc includes link.
- URL TTL/Auth: expired/unauthorized URL → retry then block with guidance.

### Telemetry Checks
- Counters present; binding health ratio stable; no URLs in prod logs.
- Degraded exitStatus mapping unchanged; other flows unaffected.

## Rollout
1) Implement hooks + guardrails + retries in Bridge
2) Add counters to telemetry; keep privacy defaults (counts‑only)
3) Update command help + Bridge docs (done); optionally add SLASH_COMMANDS note
4) Verify in staging (see QA plan)
