# User-Friendly Tree View Proposal for Annotation System (v2 • merged with refinements)

Date: 2025-09-11  
Status: Proposed (documentation only; no implementation)  
Author: System Architecture Team  
Feature Slug: `user_friendly_tree_view`

This document merges `user-friendly-tree-view-proposal-v2.md` with `refinements.md`. It keeps the phased, Option‑A–friendly trajectory and incorporates schema and operational hardening refinements.

## Executive Summary

Transform the current flat notes list into a hierarchical, folder‑based organization with a Recent section and search. Deliver value in phases:
- Phase 0 (Option A compliant): client‑only Recent + per‑note branch tree using existing data; no new APIs.
- Later phases (flagged): server‑side tree with materialized‑path schema, dual‑write migration, robust move/cycle handling, and API endpoints.

Key additions in this merged version:
- Path normalization helper (SQL) to make moves robust
- Explicit root constraint allowing multiple roots
- Configurable folder size/depth warnings (GUC‑driven trigger)
- Rate limiting/debounce guidance (middleware + client)
- Migration verification function for dual‑write safety
- Phase 0 code sketch that is truly offline (localStorage only)

## Current Problems and UX Goal

Problems: flat structure, no categorization, poor discoverability, limited context, no Recent access.
UX goal: a familiar tree with folders/notes, quick recents, search, and keyboard/a11y support.

## Visual Structure (ASCII‑safe)
```
Notes Sidebar
|-- Recent (dynamic, last 10 accessed)
|   |-- Note A (2 hours ago)
|   |-- Note B (yesterday)
|   `-- Note C (2 days ago)
`-- Knowledge Base (searchable tree)
    |-- [folder] research
    |   |-- [folder] proposals
    |   |   |-- [note] Q1 Planning
    |   |   `-- [note] Architecture Review
    |   |-- [folder] drafts
    |   |   `-- [note] API Design
    |   |-- [note] Meeting Notes
    |   `-- [note] References
    |-- [folder] projects
    |   |-- [folder] annotation-system
    |   |   `-- [note] Technical Spec
    |   `-- [note] Roadmap 2025
    |-- [folder] todo
    |   |-- [note] Weekly Tasks
    |   `-- [note] Backlog
    |-- [folder] clients
    |   `-- [note] Client A Notes
    `-- [folder] documents
        `-- [note] Templates
```

## Phased Implementation Approach

### Phase 0 — Client‑Only (Option A compliant)
- Recent Notes: store in `localStorage` (no schema changes)
- Branch Tree: render from existing `listBranches(noteId)` using current `parentId` links
- Persist UI state (expanded, selection) in `localStorage`
- No new endpoints; no Yjs; pure offline logic

Minimal sketch (documentation only):
```tsx
export function NotesExplorer() {
  const branches = useExistingBranchesAPI(); // wraps adapter.listBranches(noteId)
  const [expanded, setExpanded] = useLocalStorage<Record<string, boolean>>('tree-expanded', {});
  const [recent, setRecent] = useLocalStorage<{ id: string; lastAccessed: number }[]>('recent-notes', []);
  const tree = useMemo(() => buildTreeFromBranches(branches), [branches]);
  return <TreeView data={tree} expanded={expanded} onToggle={setExpanded} recents={recent} />;
}
```

### Phase 1 — Database & API (feature‑flagged)
- Introduce `items` table (materialized path), keep dual‑write with existing tables
- Add children/breadcrumbs endpoints; search with debounce and rate limiting
- Write unit tests for path ops; add migration verifier

### Phase 2 — UI Components
- Accessible TreeView (ARIA), drag‑drop, context menus, search bar (300ms debounce)

### Phase 3 — Integration
- Wire to editor, implement dual‑write/backfill, gradual reader cutover

### Phase 4 — Polish & Testing
- Perf targets, a11y audit, load tests, rate limiting validations

## Technical Architecture (server‑side, later phase)

### Extensions (consistent with repo)
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy search
CREATE EXTENSION IF NOT EXISTS unaccent;  -- diacritics
```

### Path Normalization Helper
```sql
CREATE OR REPLACE FUNCTION normalize_path(p TEXT)
RETURNS TEXT AS $$
  SELECT CASE 
           WHEN p IS NULL OR p = '' THEN '/'
           ELSE '/' || regexp_replace(trim(both '/' from p), '/+', '/', 'g')
         END;
$$ LANGUAGE sql IMMUTABLE;
```

### Schema — items (folders and notes)
```sql
CREATE TABLE items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             VARCHAR(10) NOT NULL CHECK (type IN ('folder','note')),
  parent_id        UUID REFERENCES items(id) ON DELETE CASCADE,
  path             TEXT NOT NULL,         -- e.g., '/knowledge-base/research/proposals'
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(255) GENERATED ALWAYS AS (
                     regexp_replace(unaccent(lower(name)), '[^a-z0-9-]+', '-', 'g')
                   ) STORED,
  position         INTEGER DEFAULT 0,
  content          JSONB,                 -- NULL for folders
  metadata         JSONB NOT NULL DEFAULT '{}',
  icon             VARCHAR(50),
  color            VARCHAR(7),
  last_accessed_at TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMP,
  -- Root rule: allow multiple single‑segment roots; non‑roots must have parent
  CHECK ((parent_id IS NULL AND path ~ '^/[^/]+$') OR (parent_id IS NOT NULL)),
  -- Advisory depth cap (enforced via trigger warnings below)
  CHECK (char_length(path) - char_length(replace(path, '/', '')) <= 100)
);

-- Indexes
CREATE UNIQUE INDEX ux_items_path         ON items(path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_items_parent_slug  ON items(parent_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_parent             ON items(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_type               ON items(type) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_name_trgm          ON items USING gin(name gin_trgm_ops)  WHERE deleted_at IS NULL;
CREATE INDEX idx_items_path_trgm          ON items USING gin(path gin_trgm_ops)  WHERE deleted_at IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_items_updated_at BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Cycle Prevention (by ID ancestry)
```sql
CREATE OR REPLACE FUNCTION check_no_cycles()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM items WHERE id = NEW.parent_id
      UNION ALL
      SELECT i.id, i.parent_id FROM items i JOIN ancestors a ON i.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Circular reference detected'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_cycles
  BEFORE UPDATE OF parent_id ON items
  FOR EACH ROW EXECUTE FUNCTION check_no_cycles();
```

### Folder Size / Depth Limits (GUC‑driven warnings)
```sql
-- Optional DB settings (fallbacks applied if unset)
-- ALTER DATABASE <db> SET app.max_folder_depth = '10';
-- ALTER DATABASE <db> SET app.max_folder_items = '1000';

CREATE OR REPLACE FUNCTION check_folder_limits()
RETURNS TRIGGER AS $$
DECLARE v_depth INT; v_count INT; v_depth_limit INT; v_items_limit INT; BEGIN
  BEGIN v_depth_limit := current_setting('app.max_folder_depth')::INT; EXCEPTION WHEN others THEN v_depth_limit := 10; END;
  BEGIN v_items_limit := current_setting('app.max_folder_items')::INT; EXCEPTION WHEN others THEN v_items_limit := 1000; END;
  v_depth := char_length(NEW.path) - char_length(replace(NEW.path, '/', ''));
  IF v_depth > v_depth_limit THEN RAISE WARNING 'Folder depth % exceeds limit % for %', v_depth, v_depth_limit, NEW.id; END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM items WHERE parent_id = NEW.parent_id AND deleted_at IS NULL;
    IF v_count > v_items_limit THEN RAISE WARNING 'Folder contains % items (limit %), parent %', v_count, v_items_limit, NEW.parent_id; END IF;
  END IF;
  RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_folder_limits
  BEFORE INSERT OR UPDATE OF parent_id, path ON items
  FOR EACH ROW EXECUTE FUNCTION check_folder_limits();
```

### Move Operation (single transaction; normalized paths)
```sql
CREATE OR REPLACE FUNCTION move_item(p_item_id UUID, p_new_parent_id UUID, p_position INTEGER DEFAULT 0)
RETURNS VOID AS $$
DECLARE v_old_path TEXT; v_new_parent_path TEXT; v_new_path TEXT; v_item_name TEXT; BEGIN
  SELECT path, name INTO v_old_path, v_item_name FROM items WHERE id = p_item_id; IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF p_new_parent_id IS NOT NULL THEN
    SELECT path INTO v_new_parent_path FROM items WHERE id = p_new_parent_id; IF NOT FOUND THEN RAISE EXCEPTION 'Parent not found'; END IF;
    v_new_path := normalize_path(v_new_parent_path || '/' || v_item_name);
  ELSE
    v_new_path := normalize_path('/' || v_item_name);
  END IF;
  UPDATE items SET parent_id = p_new_parent_id, path = v_new_path, position = COALESCE(p_position,0), updated_at = NOW() WHERE id = p_item_id;
  WITH RECURSIVE descendants AS (
    SELECT id, path FROM items WHERE parent_id = p_item_id
    UNION ALL
    SELECT i.id, i.path FROM items i JOIN descendants d ON i.parent_id = d.id
  )
  UPDATE items i
  SET path = normalize_path(v_new_path || substring(i.path FROM length(v_old_path) + 1)), updated_at = NOW()
  FROM descendants d WHERE i.id = d.id;
END; $$ LANGUAGE plpgsql;
```

## Migration Strategy (Dual‑Write + Verifier)
```sql
BEGIN;
-- Seed roots
INSERT INTO items (id, type, path, name, position) VALUES
  (gen_random_uuid(),'folder','/knowledge-base','Knowledge Base',0),
  (gen_random_uuid(),'folder','/knowledge-base/uncategorized','Uncategorized',999);

-- Backfill notes under Uncategorized
WITH kb AS (SELECT id FROM items WHERE path = '/knowledge-base/uncategorized')
INSERT INTO items (id, type, parent_id, path, name, content, created_at, updated_at)
SELECT n.id,'note',kb.id,
       '/knowledge-base/uncategorized/' || COALESCE(n.title, 'Untitled-' || substring(n.id::text,1,8)),
       COALESCE(n.title,'Untitled'), n.content, n.created_at, n.updated_at
FROM notes n, kb;

-- Dual‑write columns
ALTER TABLE annotations ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id);
ALTER TABLE panels      ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id);
UPDATE annotations SET item_id = note_id WHERE item_id IS NULL AND note_id IS NOT NULL;
UPDATE panels      SET item_id = note_id WHERE item_id IS NULL AND note_id IS NOT NULL;

-- Compatibility view
CREATE OR REPLACE VIEW notes_compat AS
  SELECT id, name AS title, content, metadata, created_at, updated_at
  FROM items WHERE type='note';

COMMIT;
```

Migration verifier (run after backfill):
```sql
CREATE OR REPLACE FUNCTION verify_migration()
RETURNS TABLE(check_name TEXT, expected BIGINT, actual BIGINT, passed BOOLEAN) AS $$
BEGIN
  RETURN QUERY SELECT 'notes_count', (SELECT COUNT(*) FROM notes), (SELECT COUNT(*) FROM items WHERE type='note'),
               (SELECT COUNT(*) FROM notes) = (SELECT COUNT(*) FROM items WHERE type='note');
  RETURN QUERY SELECT 'annotations_item_ids_match', (SELECT COUNT(*) FROM annotations WHERE note_id IS NOT NULL),
               (SELECT COUNT(*) FROM annotations WHERE item_id IS NOT NULL),
               (SELECT COUNT(*) FROM annotations WHERE note_id IS NOT NULL) = (SELECT COUNT(*) FROM annotations WHERE item_id IS NOT NULL);
  RETURN QUERY SELECT 'panels_item_ids_match', (SELECT COUNT(*) FROM panels WHERE note_id IS NOT NULL),
               (SELECT COUNT(*) FROM panels WHERE item_id IS NOT NULL),
               (SELECT COUNT(*) FROM panels WHERE note_id IS NOT NULL) = (SELECT COUNT(*) FROM panels WHERE item_id IS NOT NULL);
END; $$ LANGUAGE plpgsql;
```

Rollback (complete removal) is retained from v2; see original for details.

## API Design (later phase)
- Workhorses: `GET /api/items/:id/children`, `GET /api/items/:id/breadcrumbs`
- Recents: `GET /api/notes/recent` (optional; Phase 0 stays local)
- CRUD: `GET /items/tree`, `GET /items/:id`, `POST /items`, `PUT /items/:id`, `PUT /items/:id/move`, `DELETE /items/:id`, `POST /items/:id/restore`
- Search: `GET /items/search` (300ms debounce, 10 req/sec)

Rate limit & debounce (guidance):
```ts
import rateLimit from 'express-rate-limit';
export const rateLimiter = {
  search: rateLimit({ windowMs: 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many search requests', retryAfter: 1000 } }),
  general: rateLimit({ windowMs: 1000, max: 100, standardHeaders: true, legacyHeaders: false }),
};
const debouncedSearch = useMemo(() => debounce((q: string) => searchAPI(q), 300), []);
```

## Performance, Testing, Accessibility, Security
- Optimizations: lazy loading, virtual scroll, local caching, batched ops
- Tests: path gen, move semantics (deep subtrees), delete/restore, breadcrumbs, cycle detection, Unicode slugs
- A11y: role=tree, aria‑expanded/selected, keyboard nav, focus mgmt
- Security: path validation, sanitization, depth & size limits, parameterized SQL

## Success Metrics & Risks
- Targets carried from v2 (adoption, search usage, time‑to‑find, perf)
- Risks: migration failures, perf regressions, complex UI, lost notes during move, breaking changes
- Mitigations: dual‑write, backups, feature flags, undo/soft delete, staged rollout, compat view

## Next Steps
1. Execute Phase 0 (client‑only) for validation and feedback
2. Review this merged plan; approve feature flag rollout for Phase 1
3. Create `feat/tree-view` branch; add migrations + endpoints behind a flag

Note: This document is advisory and does not implement changes.
