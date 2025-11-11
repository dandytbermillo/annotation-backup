/**
 * Debug Logger - Logs to PostgreSQL debug_logs table
 */

const DEBUG_LOGGING_ENABLED = ['true', '1', 'on', 'yes'].includes(
  (process.env.NEXT_PUBLIC_DEBUG_LOGGING ?? '').toLowerCase()
);
const DEBUG_OVERRIDE_STORAGE_KEY = 'annotation:debug-logging';
const RUNTIME_PREF_CACHE_MS = 1000;
const RATE_LIMIT_INTERVAL_MS = 1000;
const RATE_LIMIT_MAX =
  Number(process.env.NEXT_PUBLIC_DEBUG_LOG_MAX ?? '') > 0
    ? Number(process.env.NEXT_PUBLIC_DEBUG_LOG_MAX)
    : 40; // ~40 logs/sec default before suppressing

type OverrideValue = string | boolean | null | undefined;

const parseOverride = (value: OverrideValue): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'on', 'yes', 'enable', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'off', 'no', 'disable', 'disabled'].includes(normalized)) {
    return false;
  }
  return null;
};

let cachedPreference = DEBUG_LOGGING_ENABLED;
let lastPreferenceCheck = 0;

const computeRuntimePreference = (): boolean => {
  if (typeof window === 'undefined') {
    return DEBUG_LOGGING_ENABLED;
  }

  const globalOverride = parseOverride(
    (window as typeof window & { __ANNOTATION_DEBUG_LOGGING_OVERRIDE?: OverrideValue })
      .__ANNOTATION_DEBUG_LOGGING_OVERRIDE,
  );
  if (globalOverride !== null) {
    return globalOverride;
  }

  try {
    const stored = window.localStorage.getItem(DEBUG_OVERRIDE_STORAGE_KEY);
    const storedOverride = parseOverride(stored);
    if (storedOverride !== null) {
      return storedOverride;
    }
  } catch {
    // Ignore storage errors; fall back to default
  }

  return DEBUG_LOGGING_ENABLED;
};

export const isDebugEnabled = () => {
  if (typeof window === 'undefined') {
    return DEBUG_LOGGING_ENABLED;
  }
  const now = Date.now();
  if (now - lastPreferenceCheck > RUNTIME_PREF_CACHE_MS) {
    cachedPreference = computeRuntimePreference();
    lastPreferenceCheck = now;
  }
  return cachedPreference;
};

let rateWindowStart = 0;
let rateWindowCount = 0;
let rateLimitWarned = false;

const shouldEmitDebugLog = () => {
  if (!isDebugEnabled()) {
    return false;
  }

  if (RATE_LIMIT_MAX <= 0) {
    return true;
  }

  const now = Date.now();
  if (now - rateWindowStart > RATE_LIMIT_INTERVAL_MS) {
    rateWindowStart = now;
    rateWindowCount = 0;
    rateLimitWarned = false;
  }

  if (rateWindowCount >= RATE_LIMIT_MAX) {
    if (!rateLimitWarned && typeof console !== 'undefined') {
      console.warn(
        `[DebugLogger] Suppressing debug logs after ${RATE_LIMIT_MAX} events/sec. ` +
          `Set localStorage("${DEBUG_OVERRIDE_STORAGE_KEY}","on") or raise NEXT_PUBLIC_DEBUG_LOG_MAX to re-enable.`,
      );
      rateLimitWarned = true;
    }
    return false;
  }

  rateWindowCount += 1;
  return true;
};

let sessionId: string | null = null;

// Generate or get session ID
function getSessionId(): string {
  if (!sessionId) {
    sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  return sessionId;
}

export interface DebugLogData {
  component: string;
  action: string;
  content_preview?: string;
  metadata?: Record<string, any>;
  note_id?: string | null;
}

/**
 * Log debug information to PostgreSQL
 * Supports both object format and legacy 3-parameter format
 */
export async function debugLog(
  dataOrContext: DebugLogData | string,
  event?: string,
  details?: any
): Promise<void> {
  // Early return if debug logging is disabled or rate-limited
  if (!shouldEmitDebugLog()) {
    return;
  }

  try {
    let logData: DebugLogData;

    // Support both calling styles
    if (typeof dataOrContext === 'string') {
      // Legacy 3-parameter style: debugLog('Context', 'event', {...})
      logData = {
        component: dataOrContext,
        action: event || 'unknown',
        metadata: details
      };
    } else {
      // New object style: debugLog({ component: '...', action: '...', ... })
      logData = dataOrContext;
    }

    await fetch('/api/debug/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...logData,
        session_id: getSessionId(),
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    // Fallback to console if API fails
    console.log('[DEBUG]', dataOrContext, event, details);
  }
}

/**
 * Log layer transform updates
 */
export async function logTransformUpdate(
  layerId: string,
  currentTransform: any,
  delta: any,
  newTransform: any
): Promise<void> {
  await debugLog({
    component: 'LayerProvider',
    action: 'updateTransform',
    content_preview: `Updating ${layerId} layer transform`,
    metadata: {
      layerId,
      currentTransform,
      delta,
      newTransform,
    },
  });
}

/**
 * Log panning events
 */
export async function logPanning(
  mode: string,
  layer: string,
  delta: { x: number; y: number }
): Promise<void> {
  await debugLog({
    component: 'NotesExplorer',
    action: 'panning',
    content_preview: `Panning ${layer} layer (mode: ${mode})`,
    metadata: {
      mode,
      layer,
      delta,
    },
  });
}

/**
 * Log popup overlay render
 */
export async function logPopupOverlay(
  transform: any,
  popupCount: number,
  activeLayer: string
): Promise<void> {
  await debugLog({
    component: 'PopupOverlay',
    action: 'render',
    content_preview: `Rendering popup overlay with ${popupCount} popups`,
    metadata: {
      transform,
      popupCount,
      activeLayer,
    },
  });
}
