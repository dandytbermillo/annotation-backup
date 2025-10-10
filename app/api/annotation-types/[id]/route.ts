/**
 * API Routes for Individual Annotation Types
 *
 * PUT    /api/annotation-types/[id]  - Update annotation type
 * DELETE /api/annotation-types/[id]  - Delete annotation type
 */

import { NextResponse } from 'next/server';
import { ensureAnnotationTypesReady, getAnnotationTypeRegistry } from '@/lib/bootstrap/annotation-types';
import type { AnnotationTypeConfig } from '@/lib/models/annotation-type-registry';
import {
  validateAnnotationTypeInput,
  validateNotSystemType,
} from '@/lib/validation/annotation-type-validator';
import { getServerPool } from '@/lib/db/pool';
import { z } from 'zod';

/**
 * PUT /api/annotation-types/[id]
 *
 * Update an existing annotation type.
 * System types ('note', 'explore', 'promote') cannot be updated.
 *
 * Request body: Same as POST (full annotation type object)
 *
 * @returns Updated annotation type (200) or error (400/404/500)
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

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
    //    CRITICAL: Ensure registry is initialized before accessing it
    await ensureAnnotationTypesReady();
    const registry = getAnnotationTypeRegistry();
    await registry.invalidate();

    // 6. Return updated type
    const updated = result.rows[0];
    return NextResponse.json(
      {
        id: updated.id,
        label: updated.label,
        color: updated.color,
        gradient: updated.gradient,
        icon: updated.icon,
        defaultWidth: updated.default_width,
        metadata: updated.metadata,
        isSystem: updated.is_system,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      } as AnnotationTypeConfig,
      { status: 200 }
    );
  } catch (error) {
    const { id } = await context.params;
    console.error(`[PUT /api/annotation-types/${id}] Error:`, error);

    // Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }

    // System type validation errors
    if (error instanceof Error && error.message.includes('system annotation type')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    // Generic errors
    return NextResponse.json(
      { error: 'Failed to update annotation type' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/annotation-types/[id]
 *
 * Delete an existing annotation type.
 * System types ('note', 'explore', 'promote') cannot be deleted.
 *
 * @returns Success message with deleted type (200) or error (400/404/500)
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

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
    //    CRITICAL: Ensure registry is initialized before accessing it
    await ensureAnnotationTypesReady();
    const registry = getAnnotationTypeRegistry();
    await registry.invalidate();

    // 4. Return deleted type
    const deleted = result.rows[0];
    return NextResponse.json(
      {
        success: true,
        deleted: {
          id: deleted.id,
          label: deleted.label,
          color: deleted.color,
          gradient: deleted.gradient,
          icon: deleted.icon,
          defaultWidth: deleted.default_width,
          metadata: deleted.metadata,
          isSystem: deleted.is_system,
          createdAt: deleted.created_at,
          updatedAt: deleted.updated_at,
        } as AnnotationTypeConfig,
      },
      { status: 200 }
    );
  } catch (error) {
    const { id } = await context.params;
    console.error(`[DELETE /api/annotation-types/${id}] Error:`, error);

    // System type validation errors
    if (error instanceof Error && error.message.includes('system annotation type')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    // Generic errors
    return NextResponse.json(
      { error: 'Failed to delete annotation type' },
      { status: 500 }
    );
  }
}

/**
 * Route configuration for Next.js
 * Disable static optimization to ensure fresh data
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
