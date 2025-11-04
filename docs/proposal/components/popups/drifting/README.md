# Popup Drifting Diagnosis & Fix (extended)

## Root Cause
Every time the overlay canvas pan gesture ends, `components/canvas/popup-overlay.tsx`
re-measures each popup and calls
`CoordinateBridge.screenToCanvas(localScreenPosition, activeTransform)`.
Because `activeTransform` already contains the pan delta, converting the current
screen pixels back to canvas space bakes that delta into the popup's saved
`canvasPosition`. As a result, each popup's world coordinates shift toward the
pan direction, creating a "slow drift" even after the user stops dragging.

## Fix
Gate the measurement hook so it only runs when the overlay is *not* panning or
draggings popups (`isMeasurementBlocked = isPanning || draggingPopup`). When it
does run, use the previously stored `canvasPosition` unless the popup itself was
moved or resized, so pan gestures no longer overwrite world coordinates.

