# Context-OS API-free Workflow: Detailed Spec (Advisory)

This specification refines the SSE channel, filesystem watcher, on-disk patch schema, and protections for the API‑free workflow. It is implementation-agnostic and intended to guide targeted changes in the Companion and UI.

## 1) Server-Sent Events (SSE)

- Endpoint: `GET /api/events?slug=<feature_slug>`
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- Heartbeat: send `event: heartbeat` + `{ ts }` every 25s.
- Event ID: include `id: <seq>` with a process-wide monotonically increasing integer. Support `Last-Event-ID` for resume.
- Subscribers: maintain `Map<slug, Set<Response>>`. On `close`/`error`, remove and GC.
- Capacity limits: cap per-slug and global subscriber counts (e.g., 50 per slug, 500 total) with 429 if exceeded.
- Payload hygiene: never send full doc content. Include minimal metadata only.
- Events:
  - `draft-changed`: `{ seq, slug, etag, source, ts }`
  - `patches-ready`: `{ seq, slug, types: ('sections'|'header')[], ts }`
  - `catch-up`: `{ seq, slug, etag, hasPatches: boolean, ts }`
  - `heartbeat`: `{ ts }`

Reconnect flow:
1. Browser reconnects automatically, optionally providing `Last-Event-ID`.
2. Server includes `id:` on events; `seq` always increases.
3. Client may issue an immediate GET `/api/draft/:slug/patches` to reconcile state on reconnect.

## 2) Filesystem Watcher

- Library: `chokidar`
- Root: `.tmp/initial`
- Options:
  - `ignoreInitial: true`, `depth: 3`
  - `awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }`
  - `ignored`: `**/*~`, `**/*.swp`, `**/#*#`, `**/.DS_Store`, `**/*.tmp.*`, ephemeral editor dirs
- Debounce/coalesce: per-slug debounce window 150–300ms; coalesce events into a single SSE notification.
- Cross-platform: prefer fsevents on macOS; degrade gracefully to polling for WSL/network FS; keep CPU usage bounded.
- Handling:
  - For `**/<slug>.draft.md` changes: read file, compute SHA256 (short), bump ETag (increment), store hash, emit `draft-changed`.
  - For `**/patches/<slug>/{sections.json,header.json}` changes: emit `patches-ready` with the affected types.

Cold-start recovery:
- On Companion boot, scan `.tmp/initial/**` to rebuild ETag/hash map and index any existing patches. Stale locks are pruned by age.
- On first SSE subscription for a slug, emit `catch-up` with current `etag` and `hasPatches`.

## 3) Patch Artifact Schema (on disk)

Location: `.tmp/initial/patches/<slug>/`

JSON Schema (TypeScript-like for brevity):

type UUID = string
type ISODate = string

interface BaseArtifact {
  version: 1
  slug: string
  etag: string
  nonce: UUID
  userId: string
  source: 'claude' | 'ui' | 'other'
  ts: ISODate
}

interface SectionPatch {
  id: UUID
  section: string                 // heading text, case-insensitive match
  op: 'insert' | 'replace' | 'append' | 'delete'
  anchor: { type: 'heading' | 'regex', value: string }
  suggestion?: string             // plain-text summary
  diff?: string                   // compact diff (unified or custom)
}

interface SectionsArtifact extends BaseArtifact {
  patches: SectionPatch[]
}

interface HeaderPatch {
  meta: Record<string, unknown>   // keys to set/replace in YAML front-matter
  remove?: string[]               // keys to remove (optional)
  diff?: string                   // optional presentation diff
}

interface HeaderArtifact extends BaseArtifact {
  patch: HeaderPatch
}

// Optional server response after apply
interface ApplyResult {
  status: 'applied' | 'rejected'
  reason?: string
  appliedAt?: ISODate
  appliedBy?: string
}

Rules:
- ETag required: server must compare artifact.etag against current; reject stale (409) and include current etag.
- Idempotency: artifacts include a `nonce`; server ignores duplicates within 5 minutes.
- Bounds: cap artifact size (e.g., 256KB) and patch count (e.g., 100) to avoid overload.
- Section anchoring: locate section heading; ignore fenced code blocks; reject ambiguous or missing anchors.
- YAML safety: front-matter must be valid; guard against stray `---` in body; rollback on error with clear message.
- Status: server may write `response.json` with `ApplyResult` for observability.

Readiness score note:
- The current resilient validator in the repo reports `{ ok, missing_fields, warnings, tool_version }` but not a numeric `readiness_score`. For a fully offline path, compute `readiness_score` locally from a shared rubric (e.g., `10 - missing_fields.length`, adjusted per weights) and include it in LLM Verify responses and UI. Do not rely on external LLMs for readiness in the API-free workflow.

Apply algorithm (high-level):
1) Load current content; verify etag/hash.
2) Apply header patch first; validate YAML; rollback on failure.
3) Apply section patches in order; enforce anchoring; skip fenced code; verify structure.
4) Atomic write; update etag/hash; emit `draft-changed` SSE.
5) Record `response.json` = `applied` or `rejected` with reason.

## 4) Protections & Policies

- ETag: enforce in `save`, `validate`, `verify`, `promote`. 409 with `{ code: 'STALE_ETAG', current }`.
- CSRF: 32-byte tokens; TTL 15m; required on mutations; rotate on demand.
- Origin: only allow `http://localhost:3000` and `http://localhost:3001`.
- Path: sanitize slug, use `path.relative` against whitelisted roots. Whitelist: `.tmp/initial/`, `.tmp/initial/patches/`, `docs/proposal/`. Keep locks private.
- Bind: `127.0.0.1` only. Rate-limit per `ip:path`.
- Redaction: ensure PII redaction applies to audit, metrics, and SSE payloads.
- Content hygiene: normalize LF and UTF-8 on save/promote; never send content via SSE.

Frozen semantics:
- When `status: 'frozen'` in front-matter, block semantic saves unless `/api/doc/unfreeze` with `{ reason, userId }`.
- Unfreeze: audit `reason`, bump `meta_version`, then allow edits.

Validator module caveat:
- In `server-v2.js`, the import path should reference the present validator (`./lib/resilient-validator`) instead of `./lib/content-validator` (missing). The resilient validator expects `(slug, content)` and can integrate with `AuditLogger`.

Feature flags:
- `CONTEXT_OS_SSE_ENABLED` (default on), `CONTEXT_OS_LLM_ENABLED` (validator-only mode), `CONTEXT_OS_PATCHES_MAX_SIZE`.

## 5) UI Integration

- Open `EventSource(COMANION_URL + '/api/events?slug=' + feature)` on mount.
- `draft-changed`: if editor not dirty, reload draft and update etag; else show merge/stash/reload prompt.
- `patches-ready`: fetch `/api/draft/:slug/patches`, validate schema, render in Suggestions panel.
- Reconnect handling: browsers auto-retry; show transient banner on disconnect; auto-clear on reconnect.

## 6) Metrics & Tests

Metrics:
- Counters: saves, validates, verifies, promotes, PRPs, SSE connects/disconnects, patch applies (applied/rejected).
- Latencies: save→validate; patch ingest→diff render; p50/p95/p99.
- Errors: `STALE_ETAG`, `PATH_FORBIDDEN`, YAML parse failures, SSE errors.

Acceptance tests (fast):
1) SSE round-trip patches-ready without refresh.
2) Stale ETag rejected; UI shows retry path.
3) Lock TTL takeover audited.
4) YAML failure rolls back and shows precise error.
5) Promote conflict triggers re-diff.
6) Frozen edit blocked until Unfreeze (audited with reason).
7) Cold-start emits catch-up SSE and indexes pending patches.
