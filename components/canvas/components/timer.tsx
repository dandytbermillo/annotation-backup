"use client"

import React, { useEffect, useCallback } from 'react'
import { Timer as TimerIcon, Play, Pause, RotateCcw } from 'lucide-react'
import { useComponentRegistration } from '@/lib/hooks/use-component-registration'
import {
  useComponentState,
  useWorkspaceStoreActions,
} from '@/lib/hooks/use-workspace-component-store'
import { debugLog } from '@/lib/utils/debug-logger'

interface TimerProps {
  componentId: string
  workspaceId?: string | null
  position?: { x: number; y: number }
  state?: Partial<TimerState>
  onStateUpdate?: (state: TimerState) => void
}

interface TimerState {
  minutes: number
  seconds: number
  isRunning: boolean
  inputMinutes: string
}

const DEFAULT_TIMER_STATE: TimerState = {
  minutes: 5,
  seconds: 0,
  isRunning: false,
  inputMinutes: '5',
}

/**
 * Timer Component - Phase 5 Migration
 *
 * KEY ARCHITECTURAL CHANGE:
 * - Timer interval now runs in the WORKSPACE STORE, not in React
 * - When component unmounts (workspace switch), timer keeps ticking in store
 * - Component just subscribes to store state and dispatches start/stop actions
 *
 * This enables:
 * - Timer keeps running when user switches workspaces (hot workspace)
 * - Timer properly pauses on cold restore (page reload)
 * - Single source of truth for timer state
 */
export function Timer({ componentId, workspaceId, position, state, onStateUpdate }: TimerProps) {
  // ==========================================================================
  // Phase 5: Read state from workspace component store
  // ==========================================================================

  // Subscribe to component state from store (re-renders only when THIS component's state changes)
  const storeState = useComponentState<TimerState>(workspaceId, componentId)

  // Get stable action references (don't cause re-renders)
  const actions = useWorkspaceStoreActions(workspaceId)

  // Resolve effective state: store state > prop state > defaults
  const minutes = storeState?.minutes ?? state?.minutes ?? DEFAULT_TIMER_STATE.minutes
  const seconds = storeState?.seconds ?? state?.seconds ?? DEFAULT_TIMER_STATE.seconds
  const isRunning = storeState?.isRunning ?? state?.isRunning ?? DEFAULT_TIMER_STATE.isRunning
  const inputMinutes = storeState?.inputMinutes ?? state?.inputMinutes ?? String(state?.minutes ?? DEFAULT_TIMER_STATE.inputMinutes)

  // ==========================================================================
  // Phase 5: Initialize store state if not present
  // ==========================================================================

  useEffect(() => {
    if (!workspaceId) return

    // If store doesn't have state for this component yet, initialize it
    if (storeState === null) {
      const initialState: TimerState = {
        minutes: state?.minutes ?? DEFAULT_TIMER_STATE.minutes,
        seconds: state?.seconds ?? DEFAULT_TIMER_STATE.seconds,
        isRunning: state?.isRunning ?? DEFAULT_TIMER_STATE.isRunning,
        inputMinutes: state?.inputMinutes ?? String(state?.minutes ?? DEFAULT_TIMER_STATE.inputMinutes),
      }

      actions.updateComponentState<TimerState>(componentId, initialState)

      void debugLog({
        component: 'TimerDiagnostic',
        action: 'timer_store_initialized',
        metadata: {
          componentId,
          workspaceId,
          initialState,
          sourcedFrom: state ? 'props' : 'defaults',
        },
      })
    }
  }, [workspaceId, componentId, storeState, state, actions])

  // ==========================================================================
  // Phase 5: Sync to legacy onStateUpdate callback (backward compatibility)
  // ==========================================================================

  useEffect(() => {
    if (storeState && onStateUpdate) {
      onStateUpdate(storeState)
    }
  }, [storeState, onStateUpdate])

  // ==========================================================================
  // Legacy: Register with runtime ledger (backward compatibility during migration)
  // ==========================================================================

  useComponentRegistration({
    workspaceId,
    componentId,
    componentType: 'timer',
    position,
    metadata: (storeState ?? { minutes, seconds, isRunning, inputMinutes }) as unknown as Record<string, unknown>,
    isActive: isRunning,
    strict: false,
  })

  // ==========================================================================
  // DIAGNOSTIC: Log Timer state
  // ==========================================================================

  useEffect(() => {
    void debugLog({
      component: 'TimerDiagnostic',
      action: 'timer_render_state',
      metadata: {
        componentId,
        workspaceId: workspaceId ?? 'NULL',
        hasStoreState: storeState !== null,
        effectiveState: { minutes, seconds, isRunning, inputMinutes },
        storeState: storeState ?? 'NULL',
        propState: state ?? 'NULL',
      },
    })
  }, [componentId, workspaceId, storeState, minutes, seconds, isRunning, inputMinutes, state])

  // ==========================================================================
  // Action Handlers - dispatch to store
  // ==========================================================================

  const handleStart = useCallback(() => {
    if (!workspaceId) return

    // If timer is at 0:00, reset to input minutes first
    if (minutes === 0 && seconds === 0) {
      const mins = parseInt(inputMinutes) || 5
      actions.updateComponentState<TimerState>(componentId, {
        minutes: mins,
        seconds: 0,
        isRunning: true,
      })
    } else {
      actions.updateComponentState<TimerState>(componentId, { isRunning: true })
    }

    // Start the headless timer operation in the store
    // This interval runs in the STORE, not in React - survives unmount!
    actions.startTimerOperation(componentId)

    void debugLog({
      component: 'TimerDiagnostic',
      action: 'timer_started',
      metadata: { componentId, workspaceId, minutes, seconds },
    })
  }, [workspaceId, componentId, minutes, seconds, inputMinutes, actions])

  const handlePause = useCallback(() => {
    if (!workspaceId) return

    actions.updateComponentState<TimerState>(componentId, { isRunning: false })

    // Stop the headless timer operation in the store
    actions.stopTimerOperation(componentId)

    void debugLog({
      component: 'TimerDiagnostic',
      action: 'timer_paused',
      metadata: { componentId, workspaceId, minutes, seconds },
    })
  }, [workspaceId, componentId, minutes, seconds, actions])

  const handleReset = useCallback(() => {
    if (!workspaceId) return

    // Stop any running operation first
    actions.stopTimerOperation(componentId)

    const mins = parseInt(inputMinutes) || 5
    actions.updateComponentState<TimerState>(componentId, {
      minutes: mins,
      seconds: 0,
      isRunning: false,
    })

    void debugLog({
      component: 'TimerDiagnostic',
      action: 'timer_reset',
      metadata: { componentId, workspaceId, resetTo: mins },
    })
  }, [workspaceId, componentId, inputMinutes, actions])

  const handleInputChange = useCallback((value: string) => {
    if (!workspaceId) return
    actions.updateComponentState<TimerState>(componentId, { inputMinutes: value })
  }, [workspaceId, componentId, actions])

  const formatTime = (mins: number, secs: number) => {
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const progress = (() => {
    const totalSeconds = (parseInt(inputMinutes) || 5) * 60
    const remainingSeconds = minutes * 60 + seconds
    return totalSeconds > 0 ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100 : 0
  })()

  return (
    <div className="timer-component p-4 bg-gray-900 rounded-lg">
      <div className="flex items-center mb-3">
        <TimerIcon size={16} className="text-green-400 mr-2" />
        <span className="text-xs text-gray-400">Timer</span>
        {/* Phase 5: Show indicator when timer is running in background (store-driven) */}
        {isRunning && (
          <span className="ml-auto text-xs text-green-400 animate-pulse">● Running</span>
        )}
      </div>

      <div className="text-center mb-4">
        <div className="text-4xl font-mono text-white mb-2">
          {formatTime(minutes, seconds)}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-800 rounded-full h-2 mb-4">
          <div
            className="bg-green-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Timer input */}
        <div className="flex items-center justify-center mb-4">
          <input
            type="number"
            value={inputMinutes}
            onChange={(e) => handleInputChange(e.target.value)}
            disabled={isRunning}
            className="w-20 px-2 py-1 bg-gray-800 text-white rounded text-center"
            min="1"
            max="99"
          />
          <span className="text-gray-400 ml-2">minutes</span>
        </div>

        {/* Control buttons */}
        <div className="flex justify-center gap-2">
          {!isRunning ? (
            <button
              onClick={handleStart}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <Play size={16} />
              Start
            </button>
          ) : (
            <button
              onClick={handlePause}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <Pause size={16} />
              Pause
            </button>
          )}

          <button
            onClick={handleReset}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <RotateCcw size={16} />
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}
