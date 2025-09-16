/**
 * Canvas Camera Hook
 * 
 * Provides camera-based panning functionality for the unified canvas system.
 * Replaces direct DOM manipulation with a shared camera transform.
 */

import { useCallback, useRef } from 'react'
import { useCanvas } from '@/components/canvas/canvas-context'

export interface CameraState {
  translateX: number
  translateY: number
  zoom: number
}

export interface PanCameraArgs {
  dxScreen: number  // Screen-space delta X
  dyScreen: number  // Screen-space delta Y
}

export function useCanvasCamera() {
  const { state, dispatch } = useCanvas()
  const panAccumRef = useRef({ dx: 0, dy: 0 })
  
  // Check if camera mode is enabled via feature flag
  const isCameraEnabled = process.env.NEXT_PUBLIC_CANVAS_CAMERA === '1'
  
  /**
   * Pan the camera by a screen-space delta.
   * Converts screen delta to world-space based on current zoom.
   */
  const panCameraBy = useCallback(({ dxScreen, dyScreen }: PanCameraArgs) => {
    if (!isCameraEnabled) return
    
    const currentZoom = state.canvasState?.zoom || 1
    
    // Convert screen-space delta to world-space
    // IMPORTANT: Divide by zoom to get correct world movement
    const dxWorld = dxScreen / currentZoom
    const dyWorld = dyScreen / currentZoom
    
    // Accumulate pan for smooth movement
    panAccumRef.current.dx += dxWorld
    panAccumRef.current.dy += dyWorld
    
    // Update canvas state with new camera position
    dispatch({
      type: 'SET_CANVAS_STATE',
      payload: {
        ...state.canvasState,
        translateX: (state.canvasState?.translateX || 0) + dxWorld,
        translateY: (state.canvasState?.translateY || 0) + dyWorld,
      }
    })
  }, [isCameraEnabled, state.canvasState, dispatch])
  
  /**
   * Reset accumulated pan (call after drag ends)
   */
  const resetPanAccumulation = useCallback(() => {
    panAccumRef.current = { dx: 0, dy: 0 }
  }, [])
  
  /**
   * Get accumulated pan offset (for adjusting drop coordinates)
   */
  const getPanAccumulation = useCallback(() => {
    return { ...panAccumRef.current }
  }, [])
  
  /**
   * Set camera zoom level
   */
  const setZoom = useCallback((zoom: number) => {
    if (!isCameraEnabled) return
    
    const clampedZoom = Math.max(0.5, Math.min(2, zoom))
    
    dispatch({
      type: 'SET_CANVAS_STATE',
      payload: {
        ...state.canvasState,
        zoom: clampedZoom,
      }
    })
  }, [isCameraEnabled, state.canvasState, dispatch])
  
  /**
   * Get current camera state
   */
  const getCameraState = useCallback((): CameraState => {
    return {
      translateX: state.canvasState?.translateX || 0,
      translateY: state.canvasState?.translateY || 0,
      zoom: state.canvasState?.zoom || 1,
    }
  }, [state.canvasState])
  
  return {
    panCameraBy,
    resetPanAccumulation,
    getPanAccumulation,
    setZoom,
    getCameraState,
    isCameraEnabled,
  }
}