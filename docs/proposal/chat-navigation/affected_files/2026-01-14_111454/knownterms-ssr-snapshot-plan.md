# knownTerms SSR Snapshot Plan

**Date:** 2026-01-15
**Status:** Implemented
**Scope:** Chat routing (knownTerms preload)
**Related:** `2026-01-14-doc-retrieval-routing-debt-paydown-plan.md` (TD-1 prerequisite)

## Implementation (2026-01-15)

**Files created/modified:**
- `lib/docs/known-terms-client.ts` - Added `initFromSnapshot()`, `getKnownTermsFetchStatus()`, snapshot types
- `lib/docs/known-terms-snapshot.ts` - Server-side snapshot builder (new)
- `app/providers/known-terms-provider.tsx` - Client provider to init from snapshot (new)
- `app/layout.tsx` - SSR snapshot injection
- `app/api/docs/known-terms/route.ts` - Added version hash and generatedAt
- `lib/chat/routing-telemetry.ts` - Added 'snapshot' to fetch status enum

---

## Goal

Guarantee `knownTerms` availability on cold start so routing never falls back to
`CORE_APP_TERMS` due to a cache-miss race.

---

## Non-Goals

- No change to routing logic or thresholds.
- No changes to retrieval ranking or doc content.
- No new client storage formats beyond a lightweight snapshot.

---

## Approach (SSR Snapshot + Client Cache)

### 1) Server-Side Snapshot (SSR/Build)

Embed a snapshot at render time:

```json
{
  "terms": ["workspace", "notes", "dashboard", "..."],
  "version": "sha256:abc123",
  "generatedAt": "2026-01-15T00:00:00Z"
}
```

**Requirements:**
- Include a `version`/`hash` to detect drift.
- Include a `generatedAt` timestamp for TTL validation.

**Recommended injection location:** `app/layout.tsx` (root layout)
- **Why:** Terms list is small (~35), and root injection guarantees availability before any routing.
- **Tradeoff:** Slightly larger payload on every page.

**Build vs SSR:** Prefer SSR (request-time)
- **Why:** Avoids stale builds and keeps snapshot fresh.
- **Fallback:** Build-time is acceptable only if TTL and version checks are strict.

### 2) Client Initialization

On app boot:
- If snapshot exists and is fresh (TTL), load into `knownTerms` cache.
- Then do a background fetch to update if a newer version is available.

### 3) TTL / Staleness Guard

- TTL: 7 days (configurable).
- If expired: discard snapshot and fetch from API.

---

## Data Flow

1) SSR injects snapshot into page payload.
2) Client reads snapshot → `setKnownTermsFromArray(terms)`.
3) Client records `known_terms_fetch_status = 'snapshot'` (telemetry).
4) Background `fetchKnownTerms()` updates cache if newer.

---

## Telemetry (Additions)

Add `known_terms_fetch_status = 'snapshot'` when snapshot used.
This distinguishes:

- `snapshot` (SSR preload)
- `cached` (warm cache)
- `fetched` (API fetch)
- `fetch_timeout` / `fetch_error`

---

## Acceptance Tests

1) **Cold start** (fresh session, no cache)
   - `known_terms_fetch_status = snapshot`
   - `known_terms_count > 0`

2) **Stale snapshot**
   - `generatedAt` older than TTL
   - snapshot ignored; `fetch_status = fetched`

3) **Background refresh**
   - snapshot loads immediately
   - API fetch runs async without blocking

---

## Open Questions

- None (decided above; revisit only if payload size grows substantially).
