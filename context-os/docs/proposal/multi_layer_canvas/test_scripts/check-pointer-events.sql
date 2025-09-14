-- Check if pointer events are being detected in popup overlay
-- Run this after trying to drag on the popup overlay

SELECT 
    event,
    details->>'isActiveLayer' as is_active_layer,
    details->>'popupCount' as popup_count,
    details->>'layerCtx' as layer_context,
    details->>'isEmptySpace' as is_empty_space,
    details->>'reason' as blocked_reason,
    details->>'message' as message,
    TO_CHAR(timestamp, 'HH24:MI:SS.MS') as time
FROM debug_logs 
WHERE context = 'PopupOverlay'
    AND timestamp > NOW() - INTERVAL '2 minutes'
ORDER BY timestamp DESC
LIMIT 30;

-- Check specific events
SELECT 
    event,
    COUNT(*) as count
FROM debug_logs 
WHERE context = 'PopupOverlay'
    AND timestamp > NOW() - INTERVAL '2 minutes'
GROUP BY event
ORDER BY count DESC;

-- Check transform changes
SELECT 
    event,
    details->'transform' as transform,
    details->>'isPanning' as is_panning,
    TO_CHAR(timestamp, 'HH24:MI:SS.MS') as time
FROM debug_logs 
WHERE context = 'PopupOverlay'
    AND event IN ('transform_changed', 'pan_move', 'pan_start', 'pan_end')
    AND timestamp > NOW() - INTERVAL '2 minutes'
ORDER BY timestamp DESC
LIMIT 20;