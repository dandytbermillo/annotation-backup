/**
 * API Routes for Annotation Types
 *
 * GET  /api/annotation-types     - Fetch all annotation types
 * POST /api/annotation-types     - Create a new custom annotation type
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

export async function GET() {
  try {
    // Ensure registry is loaded (lazy initialization)
    await ensureAnnotationTypesReady();

    // Get registry and fetch all types
    const registry = getAnnotationTypeRegistry();
    const types: AnnotationTypeConfig[] = registry.getAll();

    // Return types as JSON
    return NextResponse.json(types, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('[GET /api/annotation-types] Error fetching annotation types:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch annotation types',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/annotation-types
 *
 * Create a new custom annotation type.
 * System types ('note', 'explore', 'promote') cannot be created via API.
 *
 * Request body:
 * {
 *   "id": "important",
 *   "label": "Important",
 *   "color": "#e74c3c",
 *   "gradient": "linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)",
 *   "icon": "🔥",
 *   "defaultWidth": 450,
 *   "metadata": { "tags": ["urgent"], "description": "Mark as important" }
 * }
 *
 * @returns Created annotation type (201) or error (400/409/500)
 */
export async function POST(request: Request) {
  try {
    // 1. Parse request body
    const body = await request.json();

    // 2. Validate input (throws ZodError on failure)
    const input = validateAnnotationTypeInput(body);

    // 3. Check not system type (cannot create 'note', 'explore', 'promote')
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
    //    CRITICAL: Ensure registry is initialized before accessing it
    await ensureAnnotationTypesReady();
    const registry = getAnnotationTypeRegistry();
    await registry.invalidate();

    // 6. Return created type
    const created = result.rows[0];
    return NextResponse.json(
      {
        id: created.id,
        label: created.label,
        color: created.color,
        gradient: created.gradient,
        icon: created.icon,
        defaultWidth: created.default_width,
        metadata: created.metadata,
        isSystem: created.is_system,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      } as AnnotationTypeConfig,
      { status: 201 }
    );
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

    // System type validation errors
    if (error instanceof Error && error.message.includes('system annotation type')) {
      return NextResponse.json(
        { error: error.message },
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

/**
 * Route configuration for Next.js
 * Disable static optimization to ensure fresh data
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
