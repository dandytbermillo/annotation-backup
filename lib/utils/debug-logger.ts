/**
 * Debug Logger - Logs to PostgreSQL debug_logs table
 */

// Feature flag to disable debug logging
const DEBUG_LOGGING_ENABLED = ['true', '1', 'on', 'yes'].includes(
  (process.env.NEXT_PUBLIC_DEBUG_LOGGING ?? '').toLowerCase()
);

export const isDebugEnabled = () => DEBUG_LOGGING_ENABLED;

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
  // Early return if debug logging is disabled
  if (!DEBUG_LOGGING_ENABLED) {
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
