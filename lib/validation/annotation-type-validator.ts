/**
 * Comprehensive validation for annotation type creation/updates
 *
 * SECURITY: This validator is the FIRST line of defense against malicious input.
 * All POST/PUT handlers MUST call these functions before touching the database.
 *
 * Validation layers:
 * 1. Application layer (this file) - Zod schema validation
 * 2. Database layer - CHECK constraints and triggers
 *
 * Defense-in-depth: Both layers must pass for data to be accepted.
 */

import { z } from 'zod';

// Allowed metadata keys (whitelist)
// Must match the whitelist in migration 029
const METADATA_ALLOWED_KEYS = ['tags', 'description', 'category', 'author', 'version'] as const;

// Forbidden keys that enable prototype pollution
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

/**
 * Recursively scan an object for forbidden keys (prototype pollution attack)
 *
 * @param obj - Object to scan
 * @param path - Current path (for error messages)
 * @returns Error message if forbidden key found, null otherwise
 */
function deepScanForForbiddenKeys(obj: unknown, path: string = 'metadata'): string | null {
  if (obj === null || obj === undefined) {
    return null;
  }

  // Only scan objects (not arrays, primitives, etc.)
  if (typeof obj !== 'object') {
    return null;
  }

  // Scan all keys at this level
  const keys = Object.keys(obj);
  for (const key of keys) {
    // Check if key is forbidden
    if (FORBIDDEN_KEYS.includes(key as any)) {
      return `Forbidden key "${key}" found at ${path}.${key}`;
    }

    // Recursively scan nested objects
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object') {
      const nestedError = deepScanForForbiddenKeys(value, `${path}.${key}`);
      if (nestedError) {
        return nestedError;
      }
    }
  }

  return null;
}

/**
 * Zod schema for strict validation of annotation type input
 *
 * This schema enforces:
 * - ID format: lowercase alphanumeric + hyphens, starts with letter
 * - Label format: alphanumeric + spaces + hyphens
 * - Color format: 6-digit hex code
 * - Gradient format: Valid CSS gradient OR hex color, blocks javascript:/data: URIs
 * - Icon format: Emoji only (max 4 chars for sequences)
 * - Width range: 120-1200 pixels
 * - Metadata: Whitelisted keys only
 */
export const AnnotationTypeInputSchema = z.object({
  id: z.string()
    .min(1, 'ID is required')
    .max(64, 'ID too long (max 64 chars)')
    .regex(
      /^[a-z][a-z0-9-]*$/,
      'ID must start with lowercase letter, contain only a-z, 0-9, hyphen'
    ),

  label: z.string()
    .min(1, 'Label is required')
    .max(100, 'Label too long (max 100 chars)')
    .regex(
      /^[a-zA-Z0-9\s\-_()]+$/,
      'Label contains invalid characters (allowed: a-z, A-Z, 0-9, space, -, _, ())'
    ),

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
        // CRITICAL SECURITY: Block javascript:, data:, vbscript: URIs
        const forbidden = /^(javascript|data|vbscript):/i;
        return !forbidden.test(val);
      },
      { message: 'Forbidden URI scheme detected (javascript/data/vbscript not allowed)' }
    ),

  icon: z.string()
    .min(1, 'Icon is required')
    .max(4, 'Icon too long (max 4 chars for emoji sequences)')
    .regex(
      /^[\p{Emoji}\u200d]+$/u,
      'Icon must be emoji'
    ),

  defaultWidth: z.number()
    .int('Width must be integer')
    .min(120, 'Width too small (min 120)')
    .max(1200, 'Width too large (max 1200)'),

  metadata: z.record(z.unknown()).optional()
    .refine(
      (val) => {
        if (!val) return true; // Empty is OK
        const keys = Object.keys(val);
        // Check all keys are in whitelist
        return keys.every(k => METADATA_ALLOWED_KEYS.includes(k as any));
      },
      {
        message: `Metadata keys must be one of: ${METADATA_ALLOWED_KEYS.join(', ')}`,
      }
    )
    .refine(
      (val) => {
        if (!val) return true; // Empty is OK
        // Deep scan for forbidden keys (__proto__, constructor, prototype)
        const error = deepScanForForbiddenKeys(val);
        return error === null;
      },
      (val) => {
        // Return custom error message with path
        const error = deepScanForForbiddenKeys(val);
        return {
          message: error || 'Prototype pollution attempt detected',
        };
      }
    ),
});

/**
 * TypeScript type inferred from the Zod schema
 */
export type AnnotationTypeInput = z.infer<typeof AnnotationTypeInputSchema>;

/**
 * Validate input for creating a new annotation type
 *
 * @param input - Untrusted user input
 * @returns Validated and type-safe annotation type input
 * @throws {z.ZodError} If validation fails (contains detailed error messages)
 *
 * @example
 * try {
 *   const validated = validateAnnotationTypeInput(req.body);
 *   // validated is now type-safe and sanitized
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     return res.status(400).json({ error: 'Validation failed', details: error.errors });
 *   }
 * }
 */
export function validateAnnotationTypeInput(input: unknown): AnnotationTypeInput {
  return AnnotationTypeInputSchema.parse(input);
}

/**
 * Safe validation that returns errors instead of throwing
 *
 * @param input - Untrusted user input
 * @returns Success object with data OR error object with issues
 *
 * @example
 * const result = safeValidateAnnotationTypeInput(req.body);
 * if (result.success) {
 *   const validated = result.data;
 * } else {
 *   return res.status(400).json({ error: 'Validation failed', details: result.error.errors });
 * }
 */
export function safeValidateAnnotationTypeInput(input: unknown) {
  return AnnotationTypeInputSchema.safeParse(input);
}

/**
 * System annotation type IDs (cannot be modified or deleted)
 */
const SYSTEM_TYPE_IDS = ['note', 'explore', 'promote'] as const;

/**
 * Check if an ID corresponds to a system annotation type
 *
 * @param id - Annotation type ID to check
 * @returns True if ID is a system type
 *
 * @example
 * if (isSystemType('note')) {
 *   throw new Error('Cannot modify system types');
 * }
 */
export function isSystemType(id: string): boolean {
  return SYSTEM_TYPE_IDS.includes(id as any);
}

/**
 * Validate that an ID is NOT a system type (for UPDATE/DELETE operations)
 *
 * @param id - Annotation type ID to validate
 * @throws {Error} If ID is a system type
 *
 * @example
 * // In PUT/DELETE handler:
 * validateNotSystemType(params.id);
 * // Throws if trying to modify 'note', 'explore', or 'promote'
 */
export function validateNotSystemType(id: string): void {
  if (isSystemType(id)) {
    throw new Error(
      `Cannot modify system annotation type "${id}". System types are read-only.`
    );
  }
}
