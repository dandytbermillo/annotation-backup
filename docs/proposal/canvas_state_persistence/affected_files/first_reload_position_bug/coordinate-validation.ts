/**
 * Coordinate Validation Utilities
 *
 * Validates canvas coordinates for workspace and panel persistence.
 * Ensures positions are finite numbers within reasonable bounds.
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md
 */

export interface Position {
  x: number
  y: number
}

export interface ValidationError {
  field: string
  message: string
}

// Coordinate bounds (world space)
const MIN_COORDINATE = -1000000
const MAX_COORDINATE = 1000000

/**
 * Validate a single coordinate value
 */
export function isValidCoordinate(value: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_COORDINATE &&
    value <= MAX_COORDINATE
  )
}

/**
 * Validate a position object
 * Returns null if valid, error object if invalid
 */
export function validatePosition(
  position: Position,
  fieldPrefix = 'position'
): ValidationError | null {
  if (!position || typeof position !== 'object') {
    return {
      field: fieldPrefix,
      message: 'Position must be an object with x and y coordinates'
    }
  }

  if (typeof position.x !== 'number') {
    return {
      field: `${fieldPrefix}.x`,
      message: 'X coordinate must be a number'
    }
  }

  if (typeof position.y !== 'number') {
    return {
      field: `${fieldPrefix}.y`,
      message: 'Y coordinate must be a number'
    }
  }

  if (!Number.isFinite(position.x)) {
    return {
      field: `${fieldPrefix}.x`,
      message: 'X coordinate must be finite (not NaN or Infinity)'
    }
  }

  if (!Number.isFinite(position.y)) {
    return {
      field: `${fieldPrefix}.y`,
      message: 'Y coordinate must be finite (not NaN or Infinity)'
    }
  }

  if (position.x < MIN_COORDINATE || position.x > MAX_COORDINATE) {
    return {
      field: `${fieldPrefix}.x`,
      message: `X coordinate must be between ${MIN_COORDINATE} and ${MAX_COORDINATE}`
    }
  }

  if (position.y < MIN_COORDINATE || position.y > MAX_COORDINATE) {
    return {
      field: `${fieldPrefix}.y`,
      message: `Y coordinate must be between ${MIN_COORDINATE} and ${MAX_COORDINATE}`
    }
  }

  return null
}

/**
 * Validate multiple positions in a batch
 * Returns array of errors (empty if all valid)
 */
export function validatePositions(
  positions: Array<{ position: Position; fieldPrefix: string }>
): ValidationError[] {
  const errors: ValidationError[] = []

  for (const { position, fieldPrefix } of positions) {
    const error = validatePosition(position, fieldPrefix)
    if (error) {
      errors.push(error)
    }
  }

  return errors
}

/**
 * Coerce a position from unknown input
 * Returns valid position or throws error
 */
export function coercePosition(input: unknown, fieldPrefix = 'position'): Position {
  if (!input || typeof input !== 'object') {
    throw new Error(`${fieldPrefix} must be an object`)
  }

  const pos = input as Record<string, unknown>

  const x = typeof pos.x === 'string' ? parseFloat(pos.x) : pos.x
  const y = typeof pos.y === 'string' ? parseFloat(pos.y) : pos.y

  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error(`${fieldPrefix} must have numeric x and y coordinates`)
  }

  const position: Position = { x, y }
  const error = validatePosition(position, fieldPrefix)

  if (error) {
    throw new Error(error.message)
  }

  return position
}
