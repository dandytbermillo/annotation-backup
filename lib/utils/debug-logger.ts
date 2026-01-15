/**
 * Debug Logger - Logs to PostgreSQL debug_logs table
 */

// Debug logging is opt-in to avoid flooding `/api/debug/log`.
// Enable with `NEXT_PUBLIC_DEBUG_LOGGING=true` or localStorage key `annotation:debug-logging`.
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

const DEFAULT_DEBUG_LOGGING_ENABLED = (() => {
  const envOverride = parseOverride(process.env.NEXT_PUBLIC_DEBUG_LOGGING);
  return envOverride ?? false;
})();

let cachedPreference = DEFAULT_DEBUG_LOGGING_ENABLED;
let lastPreferenceCheck = 0;

const computeRuntimePreference = (): boolean => {
  if (typeof window === 'undefined') {
    return DEFAULT_DEBUG_LOGGING_ENABLED;
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

  return DEFAULT_DEBUG_LOGGING_ENABLED;
};

export const isDebugEnabled = () => {
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
  // Server-side: always allow (no rate limiting on server)
  if (typeof window === 'undefined') {
    return DEFAULT_DEBUG_LOGGING_ENABLED;
  }
  if (!isDebugEnabled()) {
    return false;
  }
  const now = Date.now();
  if (now - rateWindowStart >= RATE_LIMIT_INTERVAL_MS) {
    rateWindowStart = now;
    rateWindowCount = 0;
    rateLimitWarned = false;
  }
  rateWindowCount += 1;
  if (rateWindowCount > RATE_LIMIT_MAX) {
    if (!rateLimitWarned && typeof console !== 'undefined') {
      rateLimitWarned = true;
      console.warn(
        `[debugLog] rate limited: ${rateWindowCount}/${RATE_LIMIT_MAX} in ${RATE_LIMIT_INTERVAL_MS}ms`,
      );
    }
    return false;
  }
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
  // V5 Metrics: Structured analytics fields for retrieval quality tracking
  metrics?: {
    event: string;
    docSlug?: string;
    correctionPhrase?: string;
    excludedChunks?: number;
    optionCount?: number;
    selectedLabel?: string;
    upgradeAttempted?: boolean;
    upgradeSuccess?: boolean;
    bodyCharCount?: number;
    timestamp: number;
  };
  // TD-4: Force logging even when debug is disabled (for durable telemetry)
  forceLog?: boolean;
}

/**
 * Log debug information to PostgreSQL
 * Supports both object format and legacy 3-parameter format
 */
export async function debugLog(
  _dataOrContext: DebugLogData | string,
  _event?: string,
  _details?: any
): Promise<void> {
  const data: DebugLogData =
    typeof _dataOrContext === "string"
      ? {
          component: _dataOrContext,
          action: _event ?? "log",
          metadata: typeof _details === "object" ? _details : undefined,
        }
      : _dataOrContext

  // TD-4: forceLog bypasses the debug check for durable telemetry
  if (!data.forceLog && !shouldEmitDebugLog()) {
    return;
  }
  const timestamp = new Date().toISOString()
  const payload = JSON.stringify({
    timestamp,
    sessionId: getSessionId(),
    ...data,
  })
  try {
    if (typeof window !== "undefined" && window?.navigator?.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" })
      window.navigator.sendBeacon?.("/api/debug/log", blob)
    } else {
      await fetch("/api/debug/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      })
    }
  } catch {
    // swallow logging errors
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
