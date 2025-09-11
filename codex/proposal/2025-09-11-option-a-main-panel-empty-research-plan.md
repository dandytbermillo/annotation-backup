# Research Plan — Option A: Main Panel Content Disappears on Second Open

Status: Fixed (core issue resolved) — Optional hardening below

Paths referenced:
- Patch preview: `codex/patches/2025-09-11-option-a-batch-normalization-and-get-fallback.patch`
- Endpoints:
  - `app/api/postgres-offline/documents/batch/route.ts`
  - `app/api/postgres-offline/documents/[noteId]/[panelId]/route.ts`
  - `app/api/postgres-offline/documents/route.ts`

## 1) Context & Symptom

Environment: Option A (plain offline mode, no Yjs), per `claude.md` and `PlainModeProvider`.

Symptom observed:
- After creating a note and editing the main panel, content is preserved on the first reopen.
- When the main panel is reopened a second time (via switching notes or reloading), the main panel appears empty, while branch annotations remain visible.

Key observation:
- The editor likely loads from a different `(note_id, panel_id)` than the one used to save, so the load returns “not found” and initializes an empty editor, which is then persisted.

## 2) Current Status & Root Cause Summary

This issue is documented as fixed in:

- `docs/proposal/Option_A_Offline_Main_Content_Vanishes_After_Reload_Switch/IMPLEMENTATION_PLAN.md` (Status: Completed)

Primary causes addressed by the fix (per documentation):
- Content prop conflict: editor received both provider-loaded content and a prop, triggering fallback effects.
- Loading race: empty content could be saved during initial load.
- Fallback effect interference: fallback content effects ran despite provider presence.

Remediation already in place:
- Provider-only content flow in Option A (PlainOfflineProvider): no content prop when provider is active; editor content comes solely from `provider.loadDocument()`.
- Strict loading guards in the editor to prevent early saves.
- Disabled fallback effects when provider is present; added debug logging for visibility.

Note: During investigation we also identified a separate consistency risk in the batch endpoint (UUID regex and panel normalization). That did not drive the observed disappearance after reload/switch but is worth hardening to avoid future key drift and to surface legacy rows.

Potential consistency risk (optional hardening target):
1. Batch endpoint normalizes `panelId` using the raw `noteId` (slug) and an incorrect UUID regex — can diverge from GET, which derives `panelId` using the coerced UUID. This does not affect the already-fixed symptom with the provider-only flow, but hardening prevents future key drift and helps read legacy rows.

## 3) Current Code References (Key Excerpts)

### 3.1 GET (load) — coerces `noteId` then normalizes `panelId` with `noteKey`

File: `app/api/postgres-offline/documents/[noteId]/[panelId]/route.ts`

```ts
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

const normalizePanelId = (noteId: string, panelId: string): string => {
  if (isUuid(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}

// ...
const noteKey = coerceEntityId(noteId)
const normalizedPanelId = normalizePanelId(noteKey, panelId)
// SELECT ... WHERE note_id=$1 AND panel_id=$2 ... [noteKey, normalizedPanelId]
```

### 3.2 Single-save POST — also coerces `noteId` before normalizing `panelId`

File: `app/api/postgres-offline/documents/route.ts`

```ts
const noteKey = coerceEntityId(noteId)
const normalizedPanelId = normalizePanelId(noteKey, panelId)
// INSERT ... (note_id, panel_id, ...) VALUES (noteKey, normalizedPanelId, ...)
```

### 3.3 Batch POST/PUT — currently normalizes `panelId` using raw `noteId` and a bad UUID regex

File: `app/api/postgres-offline/documents/batch/route.ts`

```ts
// current (problematic)
const normalizePanelId = (noteId: string, panelId: string): string => {
  const isUuid = /^(?:[0-9a-fA-F]{8}-){3}[0-9a-fA-F]{12}$/
  if (isUuid.test(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}

// usage inside op loop
const { noteId, panelId, content } = op
const normalizedPanelId = normalizePanelId(noteId, panelId)
byPanel.set(`${noteId}:${normalizedPanelId}`, { ... })

// later, inserts coerce noteId/panelId individually, but the coalescing and
// normalized key above can diverge from GET’s derivation when noteId is a slug.
```

## 4) Optional Hardening (Patch Preview)

Patch file saved for review (not applied, optional):
- `codex/patches/2025-09-11-option-a-batch-normalization-and-get-fallback.patch`

Summary of changes:
- In `documents/batch/route.ts`:
  - Use `uuid.validate` instead of the incorrect regex.
  - Derive `panelId` with `normalizePanelId(coerceEntityId(noteId), panelId)`.
  - Coalesce with canonical key `${noteKey}:${normalizedPanelId}`.
- In `documents/[noteId]/[panelId]/route.ts` (GET):
  - Add a read-only fallback: if the canonical `(noteKey, normalizedPanelId)` has no rows, try the legacy key `uuidv5(rawNoteId:'main')`. Return that content if found.

Rationale (optional):
- Align normalization across batch/GET to remove any chance of future key drift (defense-in-depth).
- Add a non-destructive read fallback to surface legacy rows saved under slug-based keys (where applicable).

## 5) Safety & Efficacy Assessment (Optional Hardening)

Safety:
- Non-destructive. The GET fallback performs a second SELECT only when needed. No schema changes.
- Uses parameterized queries; no change to auth or surface area.

Efficacy:
- Stops the “main panel becomes empty on second open” by ensuring save/load use the same `(note_id, panel_id)`.
- Preserves access to legacy rows created under slug-based normalization.

Performance:
- Negligible overhead (one extra SELECT on the rare fallback path). The common path is unchanged.

## 6) Validation Plan (Post-Fix + Optional Hardening)

### 6.1 Repro (Baseline — should already pass)
1. Create new note via UI.
2. Type in main panel; confirm auto-saves (observe `/api/postgres-offline/documents/batch`).
3. Switch to another note and back (twice) or reload; observe main panel becomes empty.

### 6.2 Instrumentation (Temporary Logging)
Add server logs (locally) to print:
- In batch route, per operation: `rawNoteId`, `noteKey`, `panelId`, `normalizedPanelId`.
- In GET route: `noteId`, `noteKey`, `panelId`, `normalizedPanelId`, and whether fallback triggered.

Expected after fix:
- For the same note/panel, batch and GET log identical `normalizedPanelId`.

### 6.3 API Black-Box Checks (for optional hardening)

Assume `N_SLUG="note-123"` (forcing slug path) and `PANEL="main"`.

Save (batch):

```bash
curl -s -X POST http://localhost:3000/api/postgres-offline/documents/batch \
  -H 'Content-Type: application/json' \
  -d '{"operations":[{"noteId":"note-123","panelId":"main","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}}]}'
```

Load (GET):

```bash
curl -s http://localhost:3000/api/postgres-offline/documents/note-123/main | jq .
```

Before fix: 404; After fix: JSON with `content` or `content.html`.

### 6.4 DB Spot Checks (for optional hardening)

Compute coerced UUID for the slug and both possible `panel_id`s (requires `uuid-ossp`; migrations already require `pgcrypto` for `gen_random_uuid()`):

```sql
-- Enable extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- noteKey (coerced UUID using custom namespace from code)
SELECT uuid_generate_v5('7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a'::uuid, 'note-123') AS note_key;

-- canonical panel key (post-fix): v5(DNS, noteKey:main)
SELECT uuid_generate_v5(uuid_ns_dns(), (SELECT note_key)::text || ':main') AS panel_key_canonical;

-- legacy panel key (pre-fix): v5(DNS, rawSlug:main)
SELECT uuid_generate_v5(uuid_ns_dns(), 'note-123:main') AS panel_key_legacy;

-- Inspect rows for this note
WITH nk AS (
  SELECT uuid_generate_v5('7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a'::uuid,'note-123') AS note_key
)
SELECT note_id, panel_id, version, created_at
FROM document_saves
WHERE note_id = (SELECT note_key FROM nk)
ORDER BY created_at DESC;
```

Expected after fix:
- New versions accrue under the canonical `panel_id` only.

### 6.5 UI Scenario
1. Type in main panel, open a branch panel; switch notes twice; reload.
2. Main panel content remains present.
3. Branch panels continue to function; annotations still open.

## 7) Edge Cases & Considerations

- PanelId already a UUID: `uuid.validate` ensures we don’t re-normalize valid IDs.
- Queue/flush routes: plain mode uses batch; `queue/flush` remains consistent.
- Duplicate histories: Pre-fix content may exist under legacy `panel_id`. This patch reads it, but does not move it. A later, explicit migration can unify histories.

### 7.1 Fallback limitations (important)

- The GET fallback in the patch triggers only when both `noteId` and `panelId` are non‑UUID strings. This mirrors the legacy write path (slug + "main").
- In common flows, the UI calls GET with a UUID `noteId` (because notes are created via the API and stored by UUID), and `panelId` is "main" (non‑UUID). In that case, the fallback does not run because the original slug is not available to compute the legacy key. The canonical lookup will still miss legacy rows that were saved using a slug noteId.
- Conclusion: the fallback helps during development or where requests still use slug noteIds; for existing data written under slug keys but loaded by UUID noteId, a small data repair/migration is the reliable path to surface historical content under the canonical key.

## 8) Optional Migration (Later — only if needed)

Goal: Re-home legacy rows from `uuidv5(rawNoteId:'main')` to `uuidv5(noteKey:'main')` per `(note, panel)`, re-sequencing versions safely.

Approach (offline or admin-only task):
1. Identify affected `(note_id, legacy_panel_id)` pairs.
2. For each, copy rows to canonical `panel_id` with version re-sequencing and timestamps preserved; skip if identical content already present.
3. Optionally delete legacy rows after verification.

This is not necessary for correctness once the primary fix is live.

## 9) Rollout Plan (Optional Hardening)

1. Land the patch as a PR (small, focused change).
2. Verify in a staging session: reproduction scenario passes; API/DB checks match expectations.
3. Monitor logs for any fallback triggers (indicates presence of legacy rows).
4. Optionally plan the migration if many fallbacks occur; later remove the fallback.

## 10) Backout Plan (Optional Hardening)

Revert the patch commit. No schema changes; immediate rollback is safe.

## 11) Definition of Done

- Main panel content persists across note switches and reloads in Option A (Already met by existing fix).
- Optional hardening: Batch and GET derive identical `(note_id, panel_id)`; no unexplained 404 loads for existing content; zero fallback hits in logs after any migration (if performed).

---

## Appendix: Patch Summary (for reviewer)

### A. Batch normalization fix

```diff
- const normalizePanelId = (noteId: string, panelId: string): string => {
-   const isUuid = /^(?:[0-9a-fA-F]{8}-){3}[0-9a-fA-F]{12}$/
-   if (isUuid.test(panelId)) return panelId
-   return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
- }
+ const normalizePanelId = (noteKey: string, panelId: string): string => {
+   if (validateUuid(panelId)) return panelId
+   return uuidv5(`${noteKey}:${panelId}`, uuidv5.DNS)
+ }

- const normalizedPanelId = normalizePanelId(noteId, panelId)
+ const noteKey = coerceEntityId(noteId)
+ const normalizedPanelId = normalizePanelId(noteKey, panelId)

- byPanel.set(`${noteId}:${normalizedPanelId}`, { ... })
+ byPanel.set(`${noteKey}:${normalizedPanelId}`, { ... })
```

### B. GET fallback (read-only)

```diff
 if (result.rows.length === 0) {
+  if (!validateUuid(noteId) && !validateUuid(panelId)) {
+    const legacyPanelId = uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
+    const legacy = await pool.query(/* ... WHERE note_id=$1 AND panel_id=$2 */,[noteKey, legacyPanelId])
+    if (legacy.rows.length > 0) { /* return content */ }
+  }
   return NextResponse.json({ error: 'Document not found' }, { status: 404 })
 }
```

This aligns save/load keys and safely surfaces pre-fix data.
