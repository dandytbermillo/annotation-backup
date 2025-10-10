# Extensible Annotation Types – Production Architecture (v3)

**Date:** 2025‑01‑09  
**Status:** 📋 Proposal (Ready for build)  
**Priority:** Medium  
**Estimated Effort:** ~12 engineer hours (implementation + tests + migrations)

---

## Executive Summary

We need annotation types that can be added without editing core files, survive rolling deploys, and stay safe in multi-runtime Next.js environments. This revision replaces the previous singleton/brand approach with a database-backed type registry, runtime validation, and React integration that work across serverless/API/edge contexts.

**Key decisions**
1. **Database is source of truth** (`annotation_types` table). Registry is a cache.
2. **Lazy, process-safe bootstrap**: every runtime calls a shared `ensureAnnotationTypesReady()` helper.
3. **Observable registry** with awaited invalidation + SSR-safe hook pattern so UI updates immediately without hydration issues.
4. **Strong validation** of ids/gradients/icons/metadata to prevent XSS or injection.
5. **Dependency-injected factory** for tests and serverless friendliness—no global singleton.

---

## Current Pain Points

- Types are hard-coded (`'note' | 'explore' | 'promote'`) across UI, providers, APIs.
- Adding a new type needs changes in ≥5 files plus redeploy.
- No server/client safe initialization; singleton registry would throw in API routes.
- Type selectors can’t discover runtime additions.
- No validation on input → risk of XSS / malicious gradients / SQL characters.
- Tests share global state → flakiness.

---

## Goals

| Goal | Why |
|------|-----|
| Runtime extensibility | Teams can ship new types via config or admin UI. |
| Safe deploys and rollbacks | Works during rolling updates, multi-instance scale, and after rollback. |
| Security | Reject malicious ids, gradients, icons, metadata. |
| React parity | Server components, CSR, and Suspense hydrate with same type list. |
| Testability | Each test suite gets an isolated registry instance. |

Non-goals: UI for managing custom types (can be follow-up), cross-workspace scoping (same behavior as today).

---

## Architecture Overview

```
┌─────────────────────┐        cache/invalidate        ┌─────────────────────────┐
│ annotation_types tbl │◄──────────────────────────────►│ AnnotationTypeRegistry  │
│ (Postgres)           │                               │ (factory + observer)    │
└─────────────────────┘                                └─────────────┬───────────┘
         ▲ insert/update/delete                                   notify
         │                                                        ▼
┌─────────────────────┐                               ┌─────────────────────────┐
│ Admin/API endpoints │                               │ React hook useAnnotation│
└─────────────────────┘                               └─────────────────────────┘
```

### Data Model

New migration (`migrations/027_annotation_types.up.sql`):

```sql
CREATE TABLE annotation_types (
  id                VARCHAR(64) PRIMARY KEY,
  label             VARCHAR(100) NOT NULL,
  color             VARCHAR(7)   NOT NULL,
  gradient          TEXT         NOT NULL,
  icon              VARCHAR(16)  NOT NULL,
  default_width     INTEGER      NOT NULL CHECK (default_width BETWEEN 120 AND 1200),
  metadata          JSONB        DEFAULT '{}'::jsonb,
  is_system         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO annotation_types (id, label, color, gradient, icon, default_width, is_system)
VALUES
  ('note',    'Note',    '#3498db', 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)', '📝', 380, TRUE),
  ('explore', 'Explore', '#f39c12', 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)', '🔍', 500, TRUE),
  ('promote', 'Promote', '#27ae60', 'linear-gradient(135deg, #27ae60 0%, #229954 100%)', '⭐', 550, TRUE)
ON CONFLICT (id) DO NOTHING;
```

`branches.type` remains `TEXT NOT NULL`. We enforce validity in application code to avoid unrollbackable FK blocks. (Optional future: add FK once admin manages existing rows.)

### Registry Factory

`lib/models/annotation-type-registry.ts` exports:

```ts
export interface AnnotationTypeConfig {
  id: string;
  label: string;
  color: string;
  gradient: string;
  icon: string;
  defaultWidth: number;
  metadata?: Record<string, unknown>;
  isSystem?: boolean;
}

export interface AnnotationTypeRegistry {
  ensureLoaded(): Promise<void>;
  get(id: string): Promise<AnnotationTypeConfig | undefined>;
  getAll(): Promise<AnnotationTypeConfig[]>;
  has(id: string): Promise<boolean>;
  getIdList(): Promise<string[]>;        // cached
  subscribe(listener: () => void): () => void;
  invalidate(): void;
  close(): void;
}

export function createAnnotationTypeRegistry(pool: Pool): AnnotationTypeRegistry { /* implementation */ }
```

Implementation details:
- Single-flight loading: `ensureLoaded()` maintains a shared `loading` promise so concurrent callers reuse one query. TTL (default 30 s) governs freshness; expired caches trigger a new load while still preventing stampedes.
- Keeps an in-memory Map; all public methods `await ensureLoaded()` before reading the cache.
- `invalidate()` clears caches, immediately kicks off a fresh load, waits for completion, then notifies subscribers—callers should `await registry.invalidate()` before responding.
- `subscribe()` returns an unsubscribe that removes listeners; an internal timeout guard removes orphan listeners if cleanup never runs (e.g. thrown render). Listeners capped per process to avoid leaks.
- Emits basic metrics (loads, cache hits/misses, invalidations, subscriber count) on each operation so we can export telemetry from day one.
- No global singleton: every runtime calls `createAnnotationTypeRegistry(pgPool)` once and exports the instance via a bootstrap module.

### Validation

`validateAnnotationType(config)` throws if any rule fails:
- `id`: `/^[a-z][a-z0-9-]{1,31}$/` (lowercase, hyphen, max 32 chars, prevents path traversal).
- `label`: 1–100 printable characters.
- `color`: `^#(?:[0-9a-fA-F]{6})$`.
- `gradient`: allow only `linear-gradient(...)` without quotes `<` `>` `url(` etc.
- `icon`: ≤ 12 characters, forbid `<`, `>`, `"`, `'`, `` ` ``.
- `metadata`: optional; enforce whitelist of keys/primitive value types (e.g. `priority`, `category`, `tags`) and total serialized size < 4 KB. Anything else rejected to prevent XSS or style injection.

These checks run before inserting to DB *and* before caching.

### Bootstrap Helper

`lib/bootstrap/annotation-types.ts`:

```ts
import { createAnnotationTypeRegistry, type AnnotationTypeRegistry } from '@/lib/models/annotation-type-registry';
import { serverPool } from '@/lib/db/pool';

let registry: AnnotationTypeRegistry | null = null;
let ready: Promise<void> | null = null;

export async function ensureAnnotationTypesReady(): Promise<void> {
  if (!registry) {
    registry = createAnnotationTypeRegistry(serverPool);
  }
  if (!ready) {
    ready = registry.ensureLoaded();
  }
  try {
    await ready;
  } catch (error) {
    ready = null; // allow retry on next call
    throw error;
  }
}

export function getAnnotationTypeRegistry(): AnnotationTypeRegistry {
  if (!registry) {
    throw new Error('Annotation type registry not initialised. Call ensureAnnotationTypesReady() first.');
  }
  return registry;
}
```

Usage patterns:

- **API routes / edge functions:** top-level `await ensureAnnotationTypesReady(); const registry = getAnnotationTypeRegistry();`
- **Server components / loaders:** call `await ensureAnnotationTypesReady();` then `const registry = getAnnotationTypeRegistry(); const types = await registry.getAll();` and pass `types` to client components.
- **Client components:** accept `initialTypes` from server, call the hook to subscribe for updates.

`ensureAnnotationTypesReady()` is idempotent, so concurrent calls share the same promise with no races.

### React Integration

Pattern:

1. **Server component / loader** (Node-only) calls `await ensureAnnotationTypesReady(); const registry = getAnnotationTypeRegistry(); const types = await registry.getAll();` and passes `types` down as props.
2. **Client component** never imports the server registry. Instead it uses a light-weight client hook that:
   - Keeps the server-provided list in state.
   - Listens for browser-side broadcast events (e.g. `BroadcastChannel` or `window.dispatchEvent`) emitted by the admin/API route after invalidation.
   - Performs `fetch('/api/annotation-types')` to refresh. This keeps the browser bundle free of Node-only code.

Example client hook (`lib/hooks/use-annotation-types.ts`):

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnnotationTypeConfig } from '@/lib/models/annotation-type-registry';
import { subscribeToAnnotationTypeUpdates } from '@/lib/services/annotation-types-client'; // thin client-safe helper

export function useAnnotationTypes(initial: AnnotationTypeConfig[]): AnnotationTypeConfig[] {
  const [types, setTypes] = useState(initial);
  const isMountedRef = useRef(true);

  // keep state in sync when server-provided initial list changes
  useEffect(() => {
    setTypes(initial);
  }, [initial]);

  useEffect(() => {
    isMountedRef.current = true;

    async function refresh(signal?: AbortSignal) {
      try {
        const res = await fetch('/api/annotation-types', {
          method: 'GET',
          cache: 'no-store',
          signal,
        });
        if (!res.ok) {
          throw new Error(`Failed to fetch annotation types: ${res.status}`);
        }
        const data: AnnotationTypeConfig[] = await res.json();
        if (isMountedRef.current) {
          setTypes(data);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return; // ignore aborts on unmount
        }
        console.error('[useAnnotationTypes] Failed to refresh types', error);
      }
    }

    const abortController = new AbortController();
    // refresh immediately on mount
    refresh(abortController.signal);

    // listen for broadcasted update notifications
    const unsubscribe = subscribeToAnnotationTypeUpdates(() => {
      refresh(abortController.signal);
    });

    return () => {
      isMountedRef.current = false;
      abortController.abort();
      unsubscribe();
    };
  }, []);

  return types;
}
```

- `subscribeToAnnotationTypeUpdates` can be implemented with `BroadcastChannel`, `EventSource`, or `window.addEventListener` depending on how the admin/API route broadcasts invalidations. The client helper lives in a browser-only module and never imports server pools.
- Server components provide identical initial data → no hydration mismatch.
- The hook guards against state updates after unmount by tracking `isMountedRef`.
- API route must broadcast (e.g. `new BroadcastChannel('annotation-types').postMessage({})`) after awaiting `registry.invalidate()`.

### Provider / API Changes

1. `lib/providers/plain-offline-provider.ts`:
   - Accepts `AnnotationTypeRegistry` in constructor.
   - `changeBranchType(branchId, newType)` `await registry.has(newType)` before hitting API; otherwise throw 400.
   - When branch type changes on backend, API calls `await registry.invalidate()` so UI gets fresh data before responding.

2. `/app/api/postgres-offline/branches/[id]/change-type/route.ts`:
   - `await ensureAnnotationTypesReady()` top-level.
   - Validate `newType` via registry; return 422 with `registry.getIdList()` if invalid.

3. TypeSelector:

```tsx
// app/components/type-selector.tsx (Server Component)
import { ensureAnnotationTypesReady, getAnnotationTypeRegistry } from '@/lib/bootstrap/annotation-types';
import { TypeSelectorClient } from './type-selector-client';

export async function TypeSelector(props: { onSelect: (id: string) => void }) {
  await ensureAnnotationTypesReady();
  const registry = getAnnotationTypeRegistry();
  const types = await registry.getAll();
  return <TypeSelectorClient initialTypes={types} {...props} />;
}

// components/type-selector-client.tsx (Client Component)
'use client';
import { useAnnotationTypes } from '@/lib/hooks/use-annotation-types';

export function TypeSelectorClient({
  initialTypes,
  onSelect,
}: {
  initialTypes: AnnotationTypeConfig[];
  onSelect: (id: string) => void;
}) {
  const types = useAnnotationTypes(initialTypes);

  return (
    <Dropdown>
      {types.map((type) => (
        <DropdownItem
          key={type.id}
          onSelect={() => onSelect(type.id)}
          data-testid={`annotation-type-${type.id}`}
        >
          <span>{type.icon}</span>
          <span>{type.label}</span>
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
```

UI now displays custom types automatically without hydration mismatches.

### Admin / Registration API

- New endpoint `POST /api/annotation-types` (feature-flagged):
  1. Validates request payload using the helper.
  2. Writes to DB (`INSERT ... ON CONFLICT DO UPDATE` to allow edits).
-  3. `await ensureAnnotationTypesReady(); const registry = getAnnotationTypeRegistry(); await registry.invalidate();` to reload cache before responding.
- Deletion uses soft delete or ensures no branches reference the type before removing row.

### Testing Strategy

- `createTestRegistry()` helper spins up registry with an in-memory fake pool or sqlite.
- Each test suite constructs an instance in `beforeEach` and closes in `afterEach`.
- Integration tests run migration + seeded data; use the real factory with a test database.
- React hook tests rely on `renderHook` + `act` + mocked registry to avoid reliance on global state; verify subscriber cleanup and metrics counters reset between tests.

### Deployment / Rollback Story

1. **Deploy migration** seeding built-in types (safe to run multiple times).
2. **Deploy code** that consumes registry but only exposes built-in types (no new behavior yet).
3. Optional: **deploy admin UI** that calls registration API. Registry invalidation ensures all instances update.
4. Rollback: revert UI/API changes—types remain in DB; old code sees them but treats as unknown (fallback style). Delete rows manually if necessary.

---

## Implementation Plan

### Phase 0 – Migration Foundation
1. Add migration `027_annotation_types*.sql`.
2. Add `annotation_types` model + DB access helper `listAnnotationTypes`, `upsertAnnotationType`.
3. Seed built-in types in migration and confirm idempotency.

### Phase 1 – Registry & Bootstrap
1. Implement factory (`createAnnotationTypeRegistry`) + validation helpers (id regex, gradient/icon sanitisation, metadata whitelist).
2. Create bootstrap module (`lib/bootstrap/annotation-types.ts`) and update API/server entrypoints to `await ensureAnnotationTypesReady()`.
3. Implement single-flight/TTL caching with awaited invalidation, listener leak guard, and instrumentation counters. Unit tests cover validation, caching, invalidation, subscribe/unsubscribe, and race scenarios.

### Phase 2 – React & Provider Integration
1. Add server-component/client-component split + `useAnnotationTypes(initial)` hook; refactor TypeSelector to consume it.
2. Update plain provider + APIs to validate using registry (remove fixed unions).
3. Update TipTap extension to call `isValidAnnotationType` before applying marks.
4. Regression tests: branch type change, rename, creation flows.

### Phase 3 – Admin/API (optional)
1. Build POST/PATCH/DELETE endpoints for managing types (feature-flagged).
2. Add CLI script for seeding new types during deployment.
3. Emit audit log entries for type changes.

### Phase 4 – Observability & Hardening
1. Expose metrics endpoint / healthcheck using counters captured in Phase 1 (cache hits/misses, loads, invalidations, subscriber count, validation failures).
2. Alert if registry fails to load or validation rejects admin-created entry.
3. Load tests with hundreds of custom types to ensure acceptable latency; consider async pub/sub invalidation (Redis, Postgres LISTEN/NOTIFY) if needed.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Registry fails to load | `ensureAnnotationTypesReady()` fails fast; healthcheck surfaces error. |
| Race between DB write and cache | API awaits `registry.invalidate()` which refreshes cache before returning. |
| Rolling deploy mismatch | DB is canonical; old code ignores unknown types but still renders gracefully. |
| Malicious gradients/icons | Strict allowlist validation + optional sanitization when rendering. |
| Serverless cold starts | Cache warms per instance; TTL keeps data fresh without heavy DB load. |
| Test interference | Factory-based DI; no module-level singleton. |
| Migration rollback | Keep `annotation_types` rows; drop optional UI. No FK prevents blocking rollbacks. |

---

## Success Criteria

- ✅ Registry loads from DB in all runtimes with no init errors.
- ✅ TypeSelector automatically shows admin-registered types without reload.
- ✅ APIs reject invalid type ids with helpful error messages.
- ✅ No hydration mismatches when custom types exist.
- ✅ Tests run in isolation with DI.
- ✅ Metrics endpoint exposes cache hits/misses, loads, invalidations, subscriber count.

---

## Appendix: Example Usage

### Registering a Custom Type (Admin UI)

```ts
await fetch('/api/annotation-types', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'critical',
    label: 'Critical',
    color: '#e74c3c',
    gradient: 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)',
    icon: '🚨',
    defaultWidth: 600,
    metadata: { priority: 'high' }
  })
});
```

### Using Hook in React (Server → Client)

```tsx
// app/components/annotation-type-menu.tsx
import { ensureAnnotationTypesReady, getAnnotationTypeRegistry } from '@/lib/bootstrap/annotation-types';
import { AnnotationTypeMenuClient } from '@/components/annotation-type-menu-client';

export async function AnnotationTypeMenu(props: { onSelect: (id: string) => void }) {
  await ensureAnnotationTypesReady();
  const registry = getAnnotationTypeRegistry();
  const types = await registry.getAll();
  return <AnnotationTypeMenuClient initialTypes={types} {...props} />;
}

// components/annotation-type-menu-client.tsx
'use client';
import type { AnnotationTypeConfig } from '@/lib/models/annotation-type-registry';
import { useAnnotationTypes } from '@/lib/hooks/use-annotation-types';

export function AnnotationTypeMenuClient({
  initialTypes,
  onSelect,
}: {
  initialTypes: AnnotationTypeConfig[];
  onSelect: (id: string) => void;
}) {
  const types = useAnnotationTypes(initialTypes);

  return (
    <div role="menu">
      {types.map((type) => (
        <button key={type.id} onClick={() => onSelect(type.id)}>
          <span aria-hidden>{type.icon}</span>
          <span>{type.label}</span>
        </button>
      ))}
    </div>
  );
}
```

### Validating in Provider

```ts
async changeBranchType(branchId: string, newType: string) {
  await ensureAnnotationTypesReady();
  const registry = getAnnotationTypeRegistry();
  if (!(await registry.has(newType))) {
    const valid = await registry.getIdList();
    throw new Error(`Invalid annotation type "${newType}". Valid: ${valid.join(', ')}`);
  }
  // proceed with update…
}
```

---

**Reviewer:** _TBD_  
**Next step:** Approve implementation & create follow-up stories for Phases 0–4.
