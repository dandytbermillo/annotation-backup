/**
 * Component Type Registry
 *
 * Manages component type definitions for schema versioning, validation,
 * migration, and cold restore behavior.
 *
 * See: docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md (Section 13-14)
 *
 * Key concepts:
 * - Each component type has a schema version
 * - Old payloads migrate forward to current version
 * - Unknown types are preserved opaque (never dropped)
 * - Cold restore applies invariants (e.g., stop running timers)
 */

import type {
  ComponentTypeRegistry,
  ComponentTypeRegistryEntry,
} from './workspace-store-types'

// =============================================================================
// Registry Implementation
// =============================================================================

const registry = new Map<string, ComponentTypeRegistryEntry>()

/**
 * Global component type registry.
 */
export const componentTypeRegistry: ComponentTypeRegistry = {
  register(entry: ComponentTypeRegistryEntry): void {
    if (registry.has(entry.type)) {
      console.warn(
        `[ComponentTypeRegistry] Overwriting existing entry for type: ${entry.type}`
      )
    }
    registry.set(entry.type, entry)
  },

  get(type: string): ComponentTypeRegistryEntry | undefined {
    return registry.get(type)
  },

  has(type: string): boolean {
    return registry.has(type)
  },

  getTypes(): string[] {
    return Array.from(registry.keys())
  },
}

/**
 * Get registry entry for a component type.
 * Returns undefined for unknown types (caller should preserve opaque).
 */
export function getComponentTypeRegistryEntry(
  type: string
): ComponentTypeRegistryEntry | undefined {
  return componentTypeRegistry.get(type)
}

// =============================================================================
// Default Cold Restore Invariant
// =============================================================================

/**
 * Default cold restore invariant - deactivates common operation flags.
 * Applied to known types that don't define their own applyColdRestoreInvariant.
 */
export function defaultColdRestoreInvariant(
  state: Record<string, unknown>
): Record<string, unknown> {
  // Check for durable time anchor (opt-in to resumable behavior)
  if (state.startedAtTimestamp && state.totalDurationMs) {
    // Component explicitly opted into resumable behavior
    // Leave state unchanged - component will handle elapsed time calculation
    return state
  }

  // Default: deactivate common operation flags
  const deactivated = { ...state }
  const activeFlags = ['isRunning', 'isPlaying', 'isActive', 'isCountingDown']

  for (const flag of activeFlags) {
    if (flag in deactivated && typeof deactivated[flag] === 'boolean') {
      deactivated[flag] = false
    }
  }

  // Special case: isPaused should be true on cold restore
  if ('isPaused' in deactivated && typeof deactivated.isPaused === 'boolean') {
    deactivated.isPaused = true
  }

  return deactivated
}

// =============================================================================
// Built-in Component Type Definitions
// =============================================================================

/**
 * Timer component type definition.
 */
const timerType: ComponentTypeRegistryEntry = {
  type: 'timer',
  schemaVersion: 1,
  defaultState: {
    minutes: 5,
    seconds: 0,
    isRunning: false,
    inputMinutes: '5',
  },

  validate(state: Record<string, unknown>): Record<string, unknown> {
    const validated = { ...state }

    // Ensure minutes is a valid number
    if (typeof validated.minutes !== 'number' || validated.minutes < 0) {
      validated.minutes = 5
    }

    // Ensure seconds is a valid number (0-59)
    if (
      typeof validated.seconds !== 'number' ||
      validated.seconds < 0 ||
      validated.seconds > 59
    ) {
      validated.seconds = 0
    }

    // Ensure isRunning is boolean
    if (typeof validated.isRunning !== 'boolean') {
      validated.isRunning = false
    }

    // Ensure inputMinutes is string
    if (typeof validated.inputMinutes !== 'string') {
      validated.inputMinutes = String(validated.minutes ?? 5)
    }

    return validated
  },

  migrate(fromVersion: number, state: Record<string, unknown>): Record<string, unknown> {
    // Currently at version 1, no migrations needed yet
    // Future migrations would look like:
    // if (fromVersion < 2) { state = migrateV1toV2(state) }
    return state
  },

  applyColdRestoreInvariant(state: Record<string, unknown>): Record<string, unknown> {
    // Timer stops on cold restore (no durable time anchor by default)
    return {
      ...state,
      isRunning: false,
    }
  },
}

/**
 * Calculator component type definition.
 */
const calculatorType: ComponentTypeRegistryEntry = {
  type: 'calculator',
  schemaVersion: 1,
  defaultState: {
    display: '0',
    previousValue: null,
    operation: null,
    waitingForNewValue: false,
  },

  validate(state: Record<string, unknown>): Record<string, unknown> {
    const validated = { ...state }

    // Ensure display is a string
    if (typeof validated.display !== 'string') {
      validated.display = '0'
    }

    // Ensure waitingForNewValue is boolean
    if (typeof validated.waitingForNewValue !== 'boolean') {
      validated.waitingForNewValue = false
    }

    return validated
  },

  migrate(fromVersion: number, state: Record<string, unknown>): Record<string, unknown> {
    // Currently at version 1, no migrations needed yet
    return state
  },

  // Calculator has no active operations, so no cold restore invariant needed
  // (default behavior is fine - it just preserves the display value)
}

/**
 * Sticky Note component type definition.
 */
const stickyNoteType: ComponentTypeRegistryEntry = {
  type: 'sticky-note',
  schemaVersion: 1,
  defaultState: {
    text: '',
    color: 'yellow',
    fontSize: 14,
  },

  validate(state: Record<string, unknown>): Record<string, unknown> {
    const validated = { ...state }

    // Ensure text is a string
    if (typeof validated.text !== 'string') {
      validated.text = ''
    }

    // Ensure color is a valid string
    if (typeof validated.color !== 'string') {
      validated.color = 'yellow'
    }

    // Ensure fontSize is a valid number
    if (typeof validated.fontSize !== 'number' || validated.fontSize < 8) {
      validated.fontSize = 14
    }

    return validated
  },

  migrate(fromVersion: number, state: Record<string, unknown>): Record<string, unknown> {
    // Currently at version 1, no migrations needed yet
    return state
  },

  // Sticky note has no active operations, so no cold restore invariant needed
}

// =============================================================================
// Register Built-in Types
// =============================================================================

// Register all built-in component types
componentTypeRegistry.register(timerType)
componentTypeRegistry.register(calculatorType)
componentTypeRegistry.register(stickyNoteType)

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a component type and schema version is known and supported.
 * Used to determine if state should be preserved opaque or processed.
 */
export function isKnownComponentType(
  type: string,
  schemaVersion: number = 1
): boolean {
  const entry = componentTypeRegistry.get(type)
  if (!entry) return false
  // If incoming schema is newer than what we support, treat as unknown
  return schemaVersion <= entry.schemaVersion
}

/**
 * Process component state for restore.
 * Handles validation, migration, and cold restore invariant.
 *
 * @param type Component type
 * @param incomingSchemaVersion Schema version from DB
 * @param state State from DB
 * @param restoreType 'hot' or 'cold'
 * @returns Processed state and final schema version
 */
export function processComponentStateForRestore(
  type: string,
  incomingSchemaVersion: number,
  state: Record<string, unknown>,
  restoreType: 'hot' | 'cold'
): { state: Record<string, unknown>; schemaVersion: number; isOpaque: boolean } {
  const entry = componentTypeRegistry.get(type)

  // Unknown type or newer schema - preserve opaque
  if (!entry || incomingSchemaVersion > entry.schemaVersion) {
    return {
      state,
      schemaVersion: incomingSchemaVersion,
      isOpaque: true,
    }
  }

  // Known type - migrate, validate, apply cold restore invariant
  let processedState = state

  // Migrate from older version
  if (incomingSchemaVersion < entry.schemaVersion) {
    processedState = entry.migrate(incomingSchemaVersion, processedState)
  }

  // Validate
  processedState = entry.validate(processedState)

  // Apply cold restore invariant
  if (restoreType === 'cold') {
    processedState = entry.applyColdRestoreInvariant
      ? entry.applyColdRestoreInvariant(processedState)
      : defaultColdRestoreInvariant(processedState)
  }

  return {
    state: processedState,
    schemaVersion: entry.schemaVersion,
    isOpaque: false,
  }
}
