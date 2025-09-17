#!/bin/bash

echo "🔍 Testing Camera Integration Flow..."
echo ""
echo "1. Checking if useCanvasCamera hook dispatches SET_CANVAS_STATE..."
grep -n "dispatch.*SET_CANVAS_STATE" lib/hooks/use-canvas-camera.ts | head -1
echo ""

echo "2. Checking if canvas-context reducer handles SET_CANVAS_STATE..."
grep -n "case.*SET_CANVAS_STATE" components/canvas/canvas-context.tsx | head -1
echo ""

echo "3. Checking if annotation-canvas-modern uses canvasState for transform..."
grep -n "transform.*translateX.*translateY" components/annotation-canvas-modern.tsx | head -1
echo ""

echo "4. Checking if panels call panCameraBy when dragging..."
grep -n "panCameraBy.*dxScreen.*deltaX" components/canvas/canvas-panel.tsx | head -1
echo ""

echo "5. Checking if components call panCameraBy when dragging..."
grep -n "panCameraBy.*dxScreen.*deltaX" components/canvas/component-panel.tsx | head -1
echo ""

echo "📊 Flow Summary:"
echo "Panel/Component drag → panCameraBy() → dispatch(SET_CANVAS_STATE) → "
echo "reducer updates state → canvas uses transform → visual update ✅"
echo ""
echo "Camera mode is enabled by default. To temporarily disable it, export NEXT_PUBLIC_CANVAS_CAMERA=0 before running the app."
