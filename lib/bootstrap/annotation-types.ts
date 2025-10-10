/**
 * Annotation Types Bootstrap Module
 *
 * Lazy initialization for serverless compatibility.
 * No DB queries at module load time - only when explicitly called.
 *
 * @module lib/bootstrap/annotation-types
 */

import { getServerPool } from '@/lib/db/pool';
import { createAnnotationTypeRegistry, type AnnotationTypeRegistry } from '@/lib/models/annotation-type-registry';

/**
 * Singleton registry instance (created on first use, not at module load)
 */
let registry: AnnotationTypeRegistry | null = null;

/**
 * Shared promise for single-flight loading
 */
let ready: Promise<void> | null = null;

/**
 * Ensure annotation types are loaded and ready to use.
 * Safe to call multiple times - only initializes once.
 *
 * This function implements lazy initialization to avoid DB queries at module load time,
 * which is critical for serverless environments where modules are loaded during cold starts.
 *
 * @throws {Error} If database connection fails or types cannot be loaded
 * @returns Promise that resolves when types are loaded
 *
 * @example
 * ```typescript
 * // In an API route:
 * import { ensureAnnotationTypesReady, getAnnotationTypeRegistry } from '@/lib/bootstrap/annotation-types';
 *
 * export async function GET() {
 *   await ensureAnnotationTypesReady();
 *   const registry = getAnnotationTypeRegistry();
 *   const types = registry.getAll();
 *   return Response.json(types);
 * }
 * ```
 */
export async function ensureAnnotationTypesReady(): Promise<void> {
  // Lazy create registry on first call
  if (!registry) {
    const pool = getServerPool(); // Use function to avoid module-load DB query
    registry = createAnnotationTypeRegistry(pool);
  }

  // Single-flight pattern: reuse in-progress load
  if (!ready) {
    ready = registry.ensureLoaded();
  }

  try {
    await ready;
  } catch (error) {
    // Reset ready promise on failure to allow retry on next call
    ready = null;
    throw error;
  }
}

/**
 * Get the annotation type registry instance.
 * Must call ensureAnnotationTypesReady() first.
 *
 * @throws {Error} If registry not initialized
 * @returns The registry instance
 *
 * @example
 * ```typescript
 * await ensureAnnotationTypesReady();
 * const registry = getAnnotationTypeRegistry();
 * const noteType = registry.getById('note');
 * ```
 */
export function getAnnotationTypeRegistry(): AnnotationTypeRegistry {
  if (!registry) {
    throw new Error(
      'Annotation type registry not initialized. Call ensureAnnotationTypesReady() first.'
    );
  }
  return registry;
}

/**
 * Reset the registry (for testing only)
 * @internal
 */
export function resetAnnotationTypeRegistry(): void {
  registry = null;
  ready = null;
}
