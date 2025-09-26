import { debugLog } from '@/lib/utils/debug-logger'

/**
 * Feature Flag System for Unified Offline Foundation
 *
 * Flags:
 * - offline.circuitBreaker: Phase 1 - Smart network detection with circuit breaker
 * - offline.swCaching: Phase 2 - Service Worker caching and write replay
 * - offline.conflictUI: Phase 3 - Conflict resolution dialog
 * - ui.panMode: Canvas pan mode experiments
 *
 * The multi-layer canvas is now permanently enabled. Historical entries for
 * `ui.multiLayerCanvas` or `ui.layerModel` are scrubbed from persisted flag
 * blobs so stale localStorage does not imply those toggles still exist.
 *
 * Default: All OFF until acceptance criteria met per phase (except hardcoded
 * runtime functionality like the multi-layer canvas).
 */

interface FeatureFlags {
  'offline.circuitBreaker': boolean;
  'offline.swCaching': boolean;
  'offline.conflictUI': boolean;
  'ui.panMode': boolean;
}

// Default feature flag values (all OFF initially)
const DEFAULT_FLAGS: FeatureFlags = {
  'offline.circuitBreaker': false,
  'offline.swCaching': false,
  'offline.conflictUI': false,
  'ui.panMode': false,
};

// Environment-specific overrides
const ENV_FLAGS: Partial<FeatureFlags> = {
  // Dev environment can enable for testing
  ...(process.env.NODE_ENV === 'development' && {
    // Uncomment to enable in dev:
    // 'offline.circuitBreaker': true,
  }),
  // Staging environment flags
  ...(process.env.NEXT_PUBLIC_ENV === 'staging' && {
    // Phase 1 enabled in staging after acceptance
    // 'offline.circuitBreaker': true,
  }),
  // Production canary flags (10-20% rollout)
  ...(process.env.NEXT_PUBLIC_ENV === 'production' && {
    // Controlled via environment variables or remote config
  }),
};

// Runtime flag overrides (from localStorage for dev/testing)
let runtimeFlags: Partial<FeatureFlags> = {};

if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('offlineFeatureFlags');
    const recognizedKeys = Object.keys(DEFAULT_FLAGS) as (keyof FeatureFlags)[];
    const deprecatedKeys = ['ui.multiLayerCanvas', 'ui.layerModel'];

    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') {
        const sanitized: Partial<FeatureFlags> = {};
        const removedDeprecated: string[] = [];

        Object.entries(parsed).forEach(([key, value]) => {
          if ((recognizedKeys as string[]).includes(key)) {
            sanitized[key as keyof FeatureFlags] = Boolean(value);
          } else if (deprecatedKeys.includes(key)) {
            removedDeprecated.push(key);
          }
        });

        runtimeFlags = sanitized;

        // Ensure newly added flags are present so future reads stay consistent
        let mutated = false;
        recognizedKeys.forEach(flag => {
          if (!(flag in runtimeFlags)) {
            runtimeFlags[flag] = DEFAULT_FLAGS[flag];
            mutated = true;
          }
        });

        if (removedDeprecated.length > 0 || mutated) {
          try {
            localStorage.setItem('offlineFeatureFlags', JSON.stringify(runtimeFlags));
            debugLog({
              component: 'FeatureFlags',
              action: 'sanitize_runtime_flags',
              metadata: {
                removedDeprecated,
                runtimeFlags,
              },
            }).catch(() => {});
          } catch (error) {
            console.error('[FeatureFlags] sanitize failed', error);
          }
        }
      }
    }
  } catch (e) {
    // Ignore localStorage errors
  }
}

/**
 * Get current feature flag value
 */
export function getFeatureFlag<K extends keyof FeatureFlags>(
  flag: K
): FeatureFlags[K] {
  // Priority: runtime > env > default
  if (flag in runtimeFlags) {
    return runtimeFlags[flag] as FeatureFlags[K];
  }
  if (flag in ENV_FLAGS) {
    return ENV_FLAGS[flag] as FeatureFlags[K];
  }
  return DEFAULT_FLAGS[flag];
}

/**
 * Set runtime feature flag (dev/testing only)
 */
export function setFeatureFlag<K extends keyof FeatureFlags>(
  flag: K,
  value: FeatureFlags[K]
): void {
  if (typeof window === 'undefined') return;

  runtimeFlags[flag] = value;
  try {
    localStorage.setItem('offlineFeatureFlags', JSON.stringify(runtimeFlags));
  } catch (e) {
    console.error('Failed to save feature flags:', e);
  }
}

/**
 * Get all current feature flags
 */
export function getAllFeatureFlags(): FeatureFlags {
  return {
    ...DEFAULT_FLAGS,
    ...ENV_FLAGS,
    ...runtimeFlags,
  };
}

/**
 * Reset runtime flags to defaults
 */
export function resetFeatureFlags(): void {
  runtimeFlags = {};
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('offlineFeatureFlags');
    } catch (e) {
      // Ignore localStorage errors
    }
  }
}

/**
 * React hook for feature flags
 */
export function useFeatureFlag<K extends keyof FeatureFlags>(
  flag: K
): boolean {
  if (typeof window === 'undefined') {
    // SSR: use defaults/env only
    return ENV_FLAGS[flag] ?? DEFAULT_FLAGS[flag];
  }
  
  // Client: include runtime overrides
  return getFeatureFlag(flag);
}

/**
 * Phase rollout configuration
 */
export const PHASE_ROLLOUT = {
  phase0: {
    description: 'Foundation',
    flags: [] as const,
    environments: ['dev', 'staging', 'production'],
  },
  phase1: {
    description: 'Connectivity Foundation',
    flags: ['offline.circuitBreaker'] as const,
    environments: ['dev'], // Start in dev only
    canaryPercentage: 10, // 10% when moving to production
  },
  phase2: {
    description: 'SW Caching + Write Replay',
    flags: ['offline.swCaching'] as const,
    environments: ['dev'], // Start in dev only
    canaryPercentage: 20, // 20% when moving to production
  },
  phase3: {
    description: 'Conflict Resolution UI',
    flags: ['offline.conflictUI'] as const,
    environments: ['dev'], // Start in dev only
    canaryPercentage: 20, // 20% when moving to production
  },
};

// Export types
export type { FeatureFlags };
export type FeatureFlagKey = keyof FeatureFlags;
