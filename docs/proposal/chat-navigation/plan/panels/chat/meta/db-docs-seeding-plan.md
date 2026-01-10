# DB Docs Seeding Plan (Meta‑Explain + Retrieval)

## Goal
Store app documentation in Postgres so the chat system can retrieve reliable explanations without relying only on hardcoded text. Seed docs on first install and keep them updated safely.

## Scope
- Docs stored in repo remain source of truth.
- On startup (or migration), seed docs into DB.
- Idempotent: safe to run multiple times.

## Data Model
Create a `docs_knowledge` table:

- `id` (uuid, pk)
- `slug` (text, unique)
- `category` (text) — e.g., `concepts`, `widgets`, `actions`
- `title` (text)
- `content` (text)
- `content_hash` (text)
- `version` (text)
- `created_at`, `updated_at`

## Docs Source
- Directory: `docs/knowledge/` (or existing docs path)
- Each doc has:
  - slug (from filename)
  - category (from folder)
  - title (first heading)
  - content (full markdown)

## Seeding Strategy
1) On app startup (server side), run `seedDocs()`
2) For each doc:
   - compute `content_hash`
   - upsert by `slug`
   - if hash matches existing, skip update

## Update Rules
- **If slug exists + hash differs** → update content + updated_at
- **If slug missing** → insert
- **If doc removed from repo** → optionally mark as archived (out of scope for now)

## Retrieval Use
- Meta‑explain (Tier 2)
- Future keyword/embedding search

## Files To Add
- `migrations/###_create_docs_knowledge.up.sql`
- `migrations/###_create_docs_knowledge.down.sql`
- `lib/docs/seed-docs.ts` (loader + hash + upsert)
- (Optional) `app/api/docs/seed/route.ts` for manual re-seed

## Acceptance Tests
1) First boot → docs inserted
2) Reboot → no duplicates (hash match)
3) Modify doc → updated_at changes

## Rollback
Drop `docs_knowledge` table and remove seed hook.
