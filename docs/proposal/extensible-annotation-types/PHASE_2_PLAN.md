# Phase 2 Implementation Plan: Write Operations & Security Hardening

**Feature**: Extensible Annotation Types - Write APIs
**Status**: PLANNING
**Created**: 2025-10-09
**Priority**: HIGH (Security-Critical)

---

## Executive Summary

Phase 1 delivered a read-only annotation types system. Phase 2 adds write capabilities (POST/PUT/DELETE) with comprehensive security validation to prevent XSS, injection, and malicious data.

**Core Principle**: Security-first. All validation MUST be in place before write endpoints go live.

---

## Prerequisites (MUST COMPLETE FIRST)

### 1. Security Hardening - Database Layer ✅ TODO
**File**: `migrations/029_add_annotation_types_validation.up.sql`

**Changes**:
```sql
-- Gradient validation: Only allow valid CSS gradients or hex colors
ALTER TABLE annotation_types
ADD CONSTRAINT annotation_types_gradient_check
CHECK (
  gradient ~ '^linear-gradient\([^)]+\)$' OR
  gradient ~ '^radial-gradient\([^)]+\)$' OR
  gradient ~ '^conic-gradient\([^)]+\)$' OR
  gradient ~ '^#[0-9a-fA-F]{6}$'
);

-- Metadata validation: Define allowed keys
ALTER TABLE annotation_types
ADD CONSTRAINT annotation_types_metadata_keys_check
CHECK (
  jsonb_object_keys(metadata) <@ ARRAY['tags', 'description', 'category', 'author', 'version']::text[]
);

-- Icon validation: Prevent multi-character strings (emojis only)
ALTER TABLE annotation_types
ADD CONSTRAINT annotation_types_icon_length_check
CHECK (char_length(icon) <= 4); -- Allows emoji sequences like 👨‍💻
```

**Rollback**:
```sql
-- migrations/029_add_annotation_types_validation.down.sql
ALTER TABLE annotation_types DROP CONSTRAINT IF EXISTS annotation_types_gradient_check;
ALTER TABLE annotation_types DROP CONSTRAINT IF EXISTS annotation_types_metadata_keys_check;
ALTER TABLE annotation_types DROP CONSTRAINT IF EXISTS annotation_types_icon_length_check;
```

**Validation**:
```bash
# Test malicious gradient (should FAIL)
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "INSERT INTO annotation_types (id, label, color, gradient, icon, default_width)
   VALUES ('evil', 'Evil', '#FF0000', 'javascript:alert(1)', '💀', 400);"
# Expected: ERROR:  new row violates check constraint "annotation_types_gradient_check"

# Test valid gradient (should SUCCEED)
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "INSERT INTO annotation_types (id, label, color, gradient, icon, default_width)
   VALUES ('test', 'Test', '#FF0000', 'linear-gradient(135deg, #FF0000 0%, #AA0000 100%)', '🔥', 400);"
# Expected: INSERT 0 1
```

---

### 2. Security Hardening - Application Layer ✅ TODO
**File**: `lib/validation/annotation-type-validator.ts` (NEW)

**Purpose**: Server-side validation layer for all write operations

```typescript
/**
 * Comprehensive validation for annotation type creation/updates
 *
 * SECURITY: This validator is the FIRST line of defense against malicious input.
 * All POST/PUT handlers MUST call these functions before touching the database.
 */

import { z } from 'zod';

// Allowed metadata keys (whitelist)
const METADATA_ALLOWED_KEYS = ['tags', 'description', 'category', 'author', 'version'] as const;

// Zod schema for strict validation
export const AnnotationTypeInputSchema = z.object({
  id: z.string()
    .min(1, 'ID is required')
    .max(64, 'ID too long (max 64 chars)')
    .regex(/^[a-z][a-z0-9-]*$/, 'ID must start with lowercase letter, contain only a-z, 0-9, hyphen'),

  label: z.string()
    .min(1, 'Label is required')
    .max(100, 'Label too long (max 100 chars)')
    .regex(/^[a-zA-Z0-9\s-]+$/, 'Label contains invalid characters'),

  color: z.string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be 6-digit hex (e.g., #FF5733)'),

  gradient: z.string()
    .min(1, 'Gradient is required')
    .refine(
      (val) => {
        // Allow CSS gradients or hex colors
        const validPatterns = [
          /^linear-gradient\([^)]+\)$/,
          /^radial-gradient\([^)]+\)$/,
          /^conic-gradient\([^)]+\)$/,
          /^#[0-9a-fA-F]{6}$/,
        ];
        return validPatterns.some(pattern => pattern.test(val));
      },
      { message: 'Invalid gradient format (must be CSS gradient or hex color)' }
    )
    .refine(
      (val) => {
        // CRITICAL: Block javascript: and data: URIs
        const forbidden = /^(javascript|data|vbscript):/i;
        return !forbidden.test(val);
      },
      { message: 'Forbidden URI scheme detected' }
    ),

  icon: z.string()
    .min(1, 'Icon is required')
    .max(4, 'Icon too long (max 4 chars for emoji sequences)')
    .regex(/^[\p{Emoji}\u200d]+$/u, 'Icon must be emoji'),

  defaultWidth: z.number()
    .int('Width must be integer')
    .min(120, 'Width too small (min 120)')
    .max(1200, 'Width too large (max 1200)'),

  metadata: z.record(z.unknown()).optional()
    .refine(
      (val) => {
        if (!val) return true;
        const keys = Object.keys(val);
        return keys.every(k => METADATA_ALLOWED_KEYS.includes(k as any));
      },
      { message: `Metadata keys must be one of: ${METADATA_ALLOWED_KEYS.join(', ')}` }
    ),
});

export type AnnotationTypeInput = z.infer<typeof AnnotationTypeInputSchema>;

/**
 * Validate input for creating a new annotation type
 * @throws {z.ZodError} If validation fails
 */
export function validateAnnotationTypeInput(input: unknown): AnnotationTypeInput {
  return AnnotationTypeInputSchema.parse(input);
}

/**
 * Safe validation that returns errors instead of throwing
 */
export function safeValidateAnnotationTypeInput(input: unknown) {
  return AnnotationTypeInputSchema.safeParse(input);
}

/**
 * Additional runtime checks for system types
 */
export function isSystemType(id: string): boolean {
  return ['note', 'explore', 'promote'].includes(id);
}

export function validateNotSystemType(id: string): void {
  if (isSystemType(id)) {
    throw new Error('Cannot modify system annotation types');
  }
}
```

**Dependencies to install**:
```bash
npm install zod
```

---

### 3. Registry Enhancement - Awaited Invalidation ✅ TODO
**File**: `lib/models/annotation-type-registry.ts`

**Changes**: Add awaited `invalidate()` method that reloads BEFORE returning

```typescript
// Add to AnnotationTypeRegistry class:

/**
 * Invalidate cache and reload from database BEFORE returning
 * CRITICAL: Phase 2 POST/PUT/DELETE handlers MUST call this after DB writes
 * to ensure the registry is immediately consistent with the database.
 *
 * @returns Promise that resolves when cache is reloaded
 */
async invalidate(): Promise<void> {
  console.log('[AnnotationTypeRegistry] Invalidating cache...');

  // Clear current cache
  this.cache.clear();
  this.loaded = false;
  this.loadPromise = null;

  // Reload from DB (blocks until complete)
  await this.ensureLoaded();

  // Notify all subscribers AFTER reload completes
  this.notifySubscribers();

  console.log('[AnnotationTypeRegistry] Cache invalidated and reloaded');
}
```

**Why this matters**:
- Without awaited invalidation, API returns success but registry is stale
- Other requests might see old data immediately after POST
- Cross-tab sync works, but same-tab synchronous reads fail

---

## Core Implementation

### 4. POST Endpoint ✅ TODO
**File**: `app/api/annotation-types/route.ts`

**Add POST handler**:
```typescript
import { validateAnnotationTypeInput, validateNotSystemType } from '@/lib/validation/annotation-type-validator';
import { getServerPool } from '@/lib/db';
import { broadcastAnnotationTypeUpdate } from '@/lib/services/annotation-types-client';

export async function POST(request: Request) {
  try {
    // 1. Parse request body
    const body = await request.json();

    // 2. Validate input (throws on error)
    const input = validateAnnotationTypeInput(body);

    // 3. Check not system type
    validateNotSystemType(input.id);

    // 4. Insert into database
    const pool = getServerPool();
    const result = await pool.query(
      `INSERT INTO annotation_types
       (id, label, color, gradient, icon, default_width, metadata, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        input.id,
        input.label,
        input.color,
        input.gradient,
        input.icon,
        input.defaultWidth,
        JSON.stringify(input.metadata || {}),
        false, // Never allow creating system types via API
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Annotation type already exists' },
        { status: 409 } // Conflict
      );
    }

    // 5. Invalidate registry cache (AWAITED - blocks until reload complete)
    const registry = getAnnotationTypeRegistry();
    await registry.invalidate();

    // 6. Broadcast update to all tabs
    // NOTE: This runs on server, won't actually broadcast. Clients refetch via hook.

    // 7. Return created type
    return NextResponse.json(result.rows[0], { status: 201 });

  } catch (error) {
    console.error('[POST /api/annotation-types] Error:', error);

    // Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    // Generic errors
    return NextResponse.json(
      { error: 'Failed to create annotation type' },
      { status: 500 }
    );
  }
}
```

---

### 5. PUT Endpoint ✅ TODO
**File**: `app/api/annotation-types/[id]/route.ts` (NEW)

```typescript
import { NextResponse } from 'next/server';
import { validateAnnotationTypeInput, validateNotSystemType } from '@/lib/validation/annotation-type-validator';
import { getServerPool } from '@/lib/db';
import { getAnnotationTypeRegistry } from '@/lib/bootstrap/annotation-types';

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;

    // 1. System types cannot be modified
    validateNotSystemType(id);

    // 2. Parse and validate input
    const body = await request.json();
    const input = validateAnnotationTypeInput(body);

    // 3. Ensure ID in URL matches ID in body
    if (input.id !== id) {
      return NextResponse.json(
        { error: 'ID mismatch: URL and body must have same ID' },
        { status: 400 }
      );
    }

    // 4. Update in database
    const pool = getServerPool();
    const result = await pool.query(
      `UPDATE annotation_types
       SET label = $2, color = $3, gradient = $4, icon = $5,
           default_width = $6, metadata = $7, updated_at = NOW()
       WHERE id = $1 AND is_system = false
       RETURNING *`,
      [
        input.id,
        input.label,
        input.color,
        input.gradient,
        input.icon,
        input.defaultWidth,
        JSON.stringify(input.metadata || {}),
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Annotation type not found or is system type' },
        { status: 404 }
      );
    }

    // 5. Invalidate cache (awaited)
    const registry = getAnnotationTypeRegistry();
    await registry.invalidate();

    // 6. Return updated type
    return NextResponse.json(result.rows[0], { status: 200 });

  } catch (error) {
    console.error(`[PUT /api/annotation-types/${params.id}] Error:`, error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update annotation type' },
      { status: 500 }
    );
  }
}
```

---

### 6. DELETE Endpoint ✅ TODO
**File**: `app/api/annotation-types/[id]/route.ts` (ADD to same file)

```typescript
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;

    // 1. System types cannot be deleted
    validateNotSystemType(id);

    // 2. Delete from database
    const pool = getServerPool();
    const result = await pool.query(
      `DELETE FROM annotation_types
       WHERE id = $1 AND is_system = false
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Annotation type not found or is system type' },
        { status: 404 }
      );
    }

    // 3. Invalidate cache (awaited)
    const registry = getAnnotationTypeRegistry();
    await registry.invalidate();

    // 4. Return deleted type
    return NextResponse.json(
      { success: true, deleted: result.rows[0] },
      { status: 200 }
    );

  } catch (error) {
    console.error(`[DELETE /api/annotation-types/${params.id}] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to delete annotation type' },
      { status: 500 }
    );
  }
}
```

---

## Testing Requirements

### 7. Security Tests ✅ TODO
**File**: `__tests__/api/annotation-types-security.test.ts` (NEW)

```typescript
describe('POST /api/annotation-types - Security', () => {
  it('should reject javascript: URI in gradient', async () => {
    const res = await fetch('/api/annotation-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'evil',
        label: 'Evil',
        color: '#FF0000',
        gradient: 'javascript:alert(1)',
        icon: '💀',
        defaultWidth: 400,
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Validation failed');
  });

  it('should reject invalid metadata keys', async () => {
    const res = await fetch('/api/annotation-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'test',
        label: 'Test',
        color: '#FF0000',
        gradient: '#FF0000',
        icon: '🔥',
        defaultWidth: 400,
        metadata: { __proto__: 'malicious' },
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject modifying system types', async () => {
    const res = await fetch('/api/annotation-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'note', // System type
        label: 'Hacked Note',
        color: '#FF0000',
        gradient: '#FF0000',
        icon: '💀',
        defaultWidth: 400,
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('system');
  });
});
```

---

## Validation Gates

Before marking Phase 2 complete:

- [ ] Migration 029 applied and tested (forward + backward)
- [ ] Malicious gradient injection test FAILS (security working)
- [ ] Valid gradient test SUCCEEDS
- [ ] Zod validator tests pass (unit tests)
- [ ] POST endpoint creates type successfully
- [ ] POST endpoint rejects invalid input (400 errors)
- [ ] PUT endpoint updates type successfully
- [ ] PUT endpoint rejects system type updates
- [ ] DELETE endpoint removes type successfully
- [ ] DELETE endpoint rejects system type deletion
- [ ] Registry `invalidate()` method reloads before returning
- [ ] Cross-tab sync works after POST/PUT/DELETE
- [ ] No new TypeScript errors: `npm run type-check`
- [ ] No new lint errors: `npm run lint`
- [ ] All tests pass: `npm run test`
- [ ] Security tests pass
- [ ] Implementation report written

---

## Rollback Plan

If Phase 2 fails:

1. **Immediate**: Revert code changes, keep DB validation constraints (harmless)
2. **Partial**: Roll back migration 029 if constraints cause issues
3. **Full**: Restore Phase 1 state (read-only API)

```bash
# Rollback migration
cat migrations/029_add_annotation_types_validation.down.sql | \
  docker exec -i annotation_postgres psql -U postgres -d annotation_dev

# Revert code
git checkout main -- app/api/annotation-types/
git checkout main -- lib/validation/
git checkout main -- lib/models/annotation-type-registry.ts
```

---

## Timeline Estimate

**Conservative**: 8 hours (1 day)
- Security migration: 1 hour
- Validator implementation: 2 hours
- POST/PUT/DELETE endpoints: 2 hours
- Registry invalidate(): 1 hour
- Tests: 2 hours

**Aggressive**: 5 hours (if no issues)

---

**Status**: PLAN APPROVED - READY TO IMPLEMENT ✅
