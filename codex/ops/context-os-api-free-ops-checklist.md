# Context-OS API-free Path: Ops Checklist (Advisory)

Status: Draft preview for review. This document outlines the minimal, production-tough changes to enable the API-free workflow with local LLM tools editing files directly and the Companion broadcasting updates via SSE.

## Scope

- Enable SSE + chokidar watcher in Companion to push draft/patch events to the browser.
- Define a minimal on-disk patch protocol for Claude/IDE tools.
- Re-enable protections (ETag, CSRF, origin, path whitelist) and add a few hardening items.
- Wire UI to consume SSE and fetch patches without page refresh.

## Changes (Server)

- SSE endpoint `GET /api/events`:
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` (no compression on SSE).
  - Heartbeats: send every 25s (comment or `heartbeat` event) to keep connections alive across proxies.
  - Subscribers: track per-slug subscribers; cleanup on `close`/`error`; cap total subscribers per slug and globally (e.g., 50/500) to guard memory.
  - Resume: support `Last-Event-ID` via a monotonically increasing `seq` per process; include `id:` in frames. On new subscribe, optionally emit a catch-up snapshot.
  - Payload hygiene: never include doc content; only metadata (slug, seq, etag, types, ts, source).

- Watcher (single process-wide):
  - `chokidar.watch('.tmp/initial', { ignoreInitial: true, depth: 3, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } })`.
  - Debounce/coalesce: per-slug debounce window ~150–300ms; coalesce multiple fs events into a single SSE.
  - Ignore globs: `**/*~`, `**/*.swp`, `**/#*#`, `**/.DS_Store`, `**/*.tmp.*`, editor temp dirs.
  - On `.draft.md` change: compute hash, bump ETag (`increment`), `storeHash(slug, etag, hash)`, emit `draft-changed { slug, etag, seq, source, ts }`.
  - On patches file change: emit `patches-ready { slug, types: ['sections'|'header'], seq, ts }`.
  - Cross-platform: prefer native (fsevents on macOS); degrade to polling on WSL/network FS; keep CPU low with debounce.

- Patches endpoint `GET /api/draft/:slug/patches`:
  - Reads `.tmp/initial/patches/<slug>/{sections.json,header.json}`.
  - Returns `{ version, slug, etag, sections: Patch[], header: HeaderPatch|null }`.
  - Validates JSON against schema; rejects oversized payloads; never returns full doc content.

- Protections:
  - ETag: enforce on save/validate/verify/promote; return 409 `STALE_ETAG` with current etag.
  - CSRF + Origin: enforce for mutations with 15m token TTL; origins limited to localhost/127.0.0.1.
  - Path: whitelist `.tmp/initial/`, `.tmp/initial/patches/`, `docs/proposal/`; use `path.relative` checks to avoid traversal; locks dir stays private.
  - Bind: `127.0.0.1` only. Rate-limit per IP+path; keep idempotency on saves/promote.
  - Content hygiene: redact PII in audit/metrics/SSE; normalize LF + UTF-8 on save/promote.

- Cold-start recovery:
  - On boot, rescan `.tmp/initial/**` to rebuild ETag/hash cache, prune stale locks (by age), and index pending patches per slug.
  - On first SSE subscribe, emit catch-up events (`draft-changed` with current etag and `patches-ready` if present).

## Changes (UI)

- EventSource subscription:
  - `new EventSource(`${COMPANION_URL}/api/events?slug=${feature}`)`; rely on browser reconnect; optionally seed `Last-Event-ID` from memory.
  - `draft-changed`: if NOT dirty, reload draft and ETag; if dirty, offer merge/stash/reload with clear CTA (no silent reloads).
  - `patches-ready`: GET patches, validate schema, populate Suggestions UI; handle empty gracefully.
  - Error handling: show transient banner on SSE disconnects; auto-clear on reconnect.

- Frozen semantics:
  - If `status: 'frozen'`, block semantic saves; expose Unfreeze button that calls `/api/doc/unfreeze` with reason; audit and bump `meta_version`.

## Patch Protocol (on disk)

- Location: `.tmp/initial/patches/<slug>/`
- Files:
  - `sections.json`
    - `{ version, slug, etag, nonce, userId, source, ts, patches: Patch[] }`
  - `header.json`
    - `{ version, slug, etag, nonce, userId, source, ts, patch: HeaderPatch }`
  - `response.json` (optional)
    - Server-side apply results: `{ status: 'applied'|'rejected', reason?, appliedAt, appliedBy }`
- Types:
  - `Patch`: `{ id, section, op: 'insert'|'replace'|'append'|'delete', anchor: { type: 'heading'|'regex', value }, suggestion, diff }`
  - `HeaderPatch`: `{ meta: Record<string, any>, diff?: string }`
- Rules:
  - Require current `etag`; reject stale or mismatched with 409 and current value.
  - Section-bounded apply: locate anchor heading; ignore fenced code blocks; reject if ambiguous/missing.
  - Front-matter safety: validate YAML; detect stray `---` in body; rollback on parse error; emit precise message.
  - Size limits: cap patches file size (e.g., 256KB) and patch count (e.g., 100) to prevent abuse.
  - Idempotency: use `nonce` per artifact; ignore duplicate `nonce` within 5 minutes.

## User Identity & Audit

- `userId` end-to-end: browser → Companion → SSE payloads and audit; show “Last action by …” in UI status bar.
- Require `userId` on promote/unfreeze; record `reason` on unfreeze; bump `meta_version`.
- Tag all audit entries and SSE with `source: 'ui'|'claude'|'other'`.

## Observability & Flags

- Metrics: counters (saves, validates, verifies, promotes, PRPs, SSE connects/disconnects), latencies (save→validate, ingest→render), error rates.
- Alerts: spikes in `STALE_ETAG`, `PATH_FORBIDDEN`, SSE disconnect loops; large patches rejected.
- Feature flags: `CONTEXT_OS_SSE_ENABLED`, `CONTEXT_OS_LLM_ENABLED` (validator-only), `CONTEXT_OS_PATCHES_MAX_SIZE`.

## Acceptance Tests (fast)

1) SSE round-trip: write `sections.json` → `patches-ready` → UI renders suggestions without refresh.
2) Stale ETag: save (v123) → verify → save (v124) → ingest v123 → rejected.
3) Lock TTL: acquire lock → UI blocks → TTL expiry → force-takeover audited.
4) YAML failure: malformed header patch → rollback + error banner.
5) Promote conflict: disk change post-verify → promote rejected → re-diff required.
6) Frozen edit blocked w/o Unfreeze → Unfreeze audited with reason and `meta_version` bump.
7) Cold-start recovers pending patches and emits catch-up SSE.

## Notes

- Cross-platform: normalize LF + UTF-8 on save/promote; watcher ignore globs.
- Privacy: ensure redaction applies to SSE/metrics payloads; never send full content over SSE.

## Implementation Caveats (Current Repo State)

- Validator import mismatch in v2: `context-os/companion/server-v2.js` imports `./lib/content-validator`, but the repo contains `./lib/resilient-validator.js`. When implementing, either reintroduce `content-validator` or switch to `resilient-validator` (constructor accepts `auditLogger`).
- Readiness score source: The existing resilient validator returns `{ ok, missing_fields, warnings, tool_version }` but not a numeric `readiness_score`. Plan to compute it locally from a shared rubric module (e.g., derive from missing fields) or attach it during LLM Verify. Keep the Verify path deterministic (works offline) by using the local rubric.
- PRP endpoint: `/api/prp/create` exists in the legacy v1 server, not in v2. Port or stub in v2 before wiring the UI action.
