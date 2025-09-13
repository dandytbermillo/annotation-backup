/**
 * Debug Logger - Logs to PostgreSQL debug_logs table
 */

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
 */
export async function debugLog(data: DebugLogData): Promise<void> {
  try {
    await fetch('/api/debug/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...data,
        session_id: getSessionId(),
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    // Fallback to console if API fails
    console.log('[DEBUG]', data);
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