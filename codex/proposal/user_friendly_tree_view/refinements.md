# Refinements for User-Friendly Tree View Proposal (v2)

Document: `codex/proposal/user_friendly_tree_view/user-friendly-tree-view-proposal-v2.md`
Date: 2025-09-11
Status: Ready for incorporation (documentation only)

## Summary

These refinements are validated and strengthen the v2 proposal by tightening schema rules, making move operations robust, specifying rate limiting, adding a migration verifier, and ensuring Phase 0 remains Option‑A compliant (pure client‑side, no new APIs).

## 1) Root Path Constraint (allow multiple roots)

Current (v2):
```sql
CHECK ((parent_id IS NULL) = (path ~ '^/[^/]+$'))
```
Issue: Assumes single‑segment roots only.

Refinement (clear allowance for multiple root folders):
```sql
CHECK (
  (parent_id IS NULL AND path ~ '^/[^/]+$')  -- root items: exactly one segment (e.g., '/knowledge-base')
  OR
  (parent_id IS NOT NULL)                    -- non‑root items: parent present; path validated elsewhere
)
```
Notes:
- Keeps root rule explicit while allowing multiple independent root folders.
- Path validation for non‑roots is enforced by move/normalization logic.

## 2) Move Function: Path Normalization

Risk: `substring(i.path FROM length(v_old_path) + 1)` can be off if `v_old_path` has trailing slashes or mixed normalization.

Add a normalization helper and use it consistently whenever constructing or comparing paths.

```sql
-- Normalize path strings (remove trailing slash; ensure leading slash; collapse repeats)
CREATE OR REPLACE FUNCTION normalize_path(p TEXT)
RETURNS TEXT AS $$
  SELECT CASE 
           WHEN p IS NULL OR p = '' THEN '/'
           ELSE '/' || regexp_replace(trim(both '/' from p), '/+', '/', 'g')
         END;
$$ LANGUAGE sql IMMUTABLE;
```

Usage guidance:
- When computing `v_new_path`, apply `normalize_path(v_new_parent_path || '/' || v_item_name)`.
- Ensure existing rows are normalized in a one‑time backfill before enabling strict checks.

## 3) Folder Size / Depth Limits (configurable, advisory warnings)

Make limits configurable via custom GUCs and surface warnings (non‑blocking by default). This avoids hard failures while giving operators visibility.

```sql
-- Expect these to be set at DB/role: 
--   ALTER DATABASE <db> SET app.max_folder_depth = '10';
--   ALTER DATABASE <db> SET app.max_folder_items = '1000';

CREATE OR REPLACE FUNCTION check_folder_limits()
RETURNS TRIGGER AS $$
DECLARE
  v_depth INTEGER;
  v_count INTEGER;
  v_depth_limit INTEGER;
  v_items_limit INTEGER;
BEGIN
  -- Pull limits (fallbacks if not set)
  BEGIN
    v_depth_limit := current_setting('app.max_folder_depth')::INTEGER;
  EXCEPTION WHEN others THEN
    v_depth_limit := 10;
  END;
  BEGIN
    v_items_limit := current_setting('app.max_folder_items')::INTEGER;
  EXCEPTION WHEN others THEN
    v_items_limit := 1000;
  END;

  -- Compute depth (count of '/') and warn if exceeded
  v_depth := char_length(NEW.path) - char_length(replace(NEW.path, '/', ''));
  IF v_depth > v_depth_limit THEN
    RAISE WARNING 'Folder depth % exceeds limit % for item %', v_depth, v_depth_limit, NEW.id;
  END IF;

  -- Folder size warning on INSERT/UPDATE that assigns parent
  IF NEW.parent_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM items WHERE parent_id = NEW.parent_id AND deleted_at IS NULL;
    IF v_count > v_items_limit THEN
      RAISE WARNING 'Folder contains % items (limit %), parent %', v_count, v_items_limit, NEW.parent_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_folder_limits ON items;
CREATE TRIGGER trg_check_folder_limits
  BEFORE INSERT OR UPDATE OF parent_id, path ON items
  FOR EACH ROW
  EXECUTE FUNCTION check_folder_limits();
```

Optionally, promote warnings to errors after initial stabilization.

## 4) Rate Limiting & Debounce: Where and How

Keep Phase 0 fully client‑side (no new APIs). For later API phases, specify both middleware rate limiting and client‑side debounce.

```ts
// Middleware / route wrapper (Node/Next.js example)
import rateLimit from 'express-rate-limit' // or Next-compatible wrapper

export const rateLimiter = {
  search: rateLimit({
    windowMs: 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many search requests', retryAfter: 1000 },
  }),
  general: rateLimit({
    windowMs: 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  }),
}

// Client-side debounce (React)
const debouncedSearch = useMemo(
  () => debounce((q: string) => searchAPI(q), 300),
  []
)
```

Notes:
- Apply `rateLimiter.search` to `/api/items/search` only; `general` to others as needed.
- Return 429 with `Retry-After` (seconds or ms) to guide UI backoff.

## 5) Migration Safety Verifier

Provide a quick integrity check after backfill/dual‑write.

```sql
CREATE OR REPLACE FUNCTION verify_migration()
RETURNS TABLE(
  check_name TEXT,
  expected BIGINT,
  actual BIGINT,
  passed BOOLEAN
) AS $$
BEGIN
  -- Notes count parity
  RETURN QUERY
  SELECT 'notes_count',
         (SELECT COUNT(*) FROM notes),
         (SELECT COUNT(*) FROM items WHERE type = 'note'),
         (SELECT COUNT(*) FROM notes) = (SELECT COUNT(*) FROM items WHERE type = 'note');

  -- Annotations: note_id vs item_id populated
  RETURN QUERY
  SELECT 'annotations_item_ids_match',
         (SELECT COUNT(*) FROM annotations WHERE note_id IS NOT NULL),
         (SELECT COUNT(*) FROM annotations WHERE item_id IS NOT NULL),
         (SELECT COUNT(*) FROM annotations WHERE note_id IS NOT NULL) =
         (SELECT COUNT(*) FROM annotations WHERE item_id IS NOT NULL);

  -- Panels: note_id vs item_id populated
  RETURN QUERY
  SELECT 'panels_item_ids_match',
         (SELECT COUNT(*) FROM panels WHERE note_id IS NOT NULL),
         (SELECT COUNT(*) FROM panels WHERE item_id IS NOT NULL),
         (SELECT COUNT(*) FROM panels WHERE note_id IS NOT NULL) =
         (SELECT COUNT(*) FROM panels WHERE item_id IS NOT NULL);
END;
$$ LANGUAGE plpgsql;
```

Run after dual‑write and backfill; include in rollout checklist.

## 6) Option A Phase 0 Alignment (pure client‑side)

Ensure the initial delivery adds value without new APIs.

```tsx
// Phase 0: Client-only NotesExplorer sketch (no new endpoints)
export function NotesExplorer() {
  // EXISTING data only (localStorage + current adapter methods)
  const branches = useExistingBranchesAPI(); // wraps adapter.listBranches(noteId)

  // Local state
  const [expanded, setExpanded] = useLocalStorage<Record<string, boolean>>('tree-expanded', {});
  const [recent, setRecent] = useLocalStorage<{ id: string; lastAccessed: number }[]>('recent-notes', []);

  // Build tree from existing parentId relationships (main -> branches -> sub-branches)
  const tree = useMemo(() => buildTreeFromBranches(branches), [branches]);

  // No new network calls in Phase 0
  return <TreeView data={tree} expanded={expanded} onToggle={setExpanded} recents={recent} />;
}
```

## Updated Recommendation (before implementation)

1. Add path normalization everywhere paths are constructed/compared.
2. Make folder depth and item count limits configurable via database settings (GUCs); start as warnings.
3. Specify rate limiting at middleware level and debounce on client.
4. Add a migration verification function and include it in rollout gates.
5. Keep Phase 0 truly offline (localStorage only; reuse existing APIs).
6. Add comprehensive edge‑case tests for move operations (root moves, deep subtrees, rename + move, concurrent updates).

---

These refinements can be merged into the v2 proposal document or kept adjacent as an implementation checklist. No application code changes are included in this document.

