"use client"

import React, { useEffect, useCallback } from 'react'
import { Calculator as CalcIcon } from 'lucide-react'
import { useComponentRegistration } from '@/lib/hooks/use-component-registration'
import {
  useComponentState,
  useWorkspaceStoreActions,
} from '@/lib/hooks/use-workspace-component-store'
import { debugLog } from '@/lib/utils/debug-logger'

interface CalculatorProps {
  componentId: string
  workspaceId?: string | null
  position?: { x: number; y: number }
  state?: CalculatorState
  onStateUpdate?: (state: CalculatorState) => void
}

interface CalculatorState {
  display: string
  previousValue: number | null
  operation: string | null
  waitingForNewValue: boolean
}

const DEFAULT_CALCULATOR_STATE: CalculatorState = {
  display: '0',
  previousValue: null,
  operation: null,
  waitingForNewValue: false,
}

/**
 * Calculator Component - Phase 5 Migration
 *
 * Migrated to use workspace component store for state management.
 * Calculator has no background operations, but benefits from:
 * - Single source of truth
 * - Proper cold restore
 * - Consistent persistence
 */
export function Calculator({ componentId, workspaceId, position, state, onStateUpdate }: CalculatorProps) {
  // ==========================================================================
  // Phase 5: Read state from workspace component store
  // ==========================================================================

  // DEBUG: Log workspaceId on every render
  useEffect(() => {
    void debugLog({
      component: 'CalculatorDiagnostic',
      action: 'calculator_workspaceId_check',
      metadata: {
        componentId,
        workspaceId: workspaceId ?? 'NULL',
        workspaceIdType: typeof workspaceId,
        workspaceIdTruthy: !!workspaceId,
      },
    })
  }, [workspaceId, componentId])

  const storeState = useComponentState<CalculatorState>(workspaceId, componentId)
  const actions = useWorkspaceStoreActions(workspaceId)

  // Resolve effective state: store state > prop state > defaults
  const display = storeState?.display ?? state?.display ?? DEFAULT_CALCULATOR_STATE.display
  const previousValue = storeState?.previousValue ?? state?.previousValue ?? DEFAULT_CALCULATOR_STATE.previousValue
  const operation = storeState?.operation ?? state?.operation ?? DEFAULT_CALCULATOR_STATE.operation
  const waitingForNewValue = storeState?.waitingForNewValue ?? state?.waitingForNewValue ?? DEFAULT_CALCULATOR_STATE.waitingForNewValue

  // ==========================================================================
  // Phase 5: Initialize store state if not present
  // ==========================================================================

  useEffect(() => {
    if (!workspaceId) return

    // If store doesn't have state for this component yet, add it
    // NOTE: Use addComponent (not updateComponentState) because updateComponentState
    // requires the component to already exist in the store. For new components,
    // we need to create the full component entry first.
    if (storeState === null) {
      const initialState: CalculatorState = {
        display: state?.display ?? DEFAULT_CALCULATOR_STATE.display,
        previousValue: state?.previousValue ?? DEFAULT_CALCULATOR_STATE.previousValue,
        operation: state?.operation ?? DEFAULT_CALCULATOR_STATE.operation,
        waitingForNewValue: state?.waitingForNewValue ?? DEFAULT_CALCULATOR_STATE.waitingForNewValue,
      }

      // addComponent is idempotent - safe if component already exists
      actions.addComponent(componentId, {
        type: 'calculator',
        schemaVersion: 1,
        position: position ?? { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: initialState as unknown as Record<string, unknown>,
      })

      void debugLog({
        component: 'CalculatorDiagnostic',
        action: 'calculator_store_initialized',
        metadata: { componentId, workspaceId, initialState },
      })
    }
  }, [workspaceId, componentId, storeState, state, actions, position])

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
    componentType: 'calculator',
    position,
    metadata: (storeState ?? { display, previousValue, operation, waitingForNewValue }) as unknown as Record<string, unknown>,
    isActive: false, // Calculator has no background operations
    strict: false,
  })
  
  // ==========================================================================
  // Action Handlers - dispatch to store
  // ==========================================================================

  // TEST FUNCTION: Makes calculator unresponsive for testing isolation
  const makeUnresponsive = () => {
    console.log('🔴 Making calculator unresponsive for 5 seconds...')
    const start = Date.now()
    while (Date.now() - start < 5000) {
      // Intentionally block the thread for testing
      Math.sqrt(Math.random())
    }
    console.log('✅ Calculator responsive again')
  }

  const inputNumber = useCallback((num: string) => {
    void debugLog({
      component: 'CalculatorDiagnostic',
      action: 'calculator_inputNumber_called',
      metadata: { componentId, workspaceId: workspaceId ?? 'NULL', num },
    })
    if (!workspaceId) {
      void debugLog({
        component: 'CalculatorDiagnostic',
        action: 'calculator_input_BLOCKED',
        metadata: { componentId, workspaceId: workspaceId ?? 'NULL', num, reason: 'workspaceId_falsy' },
      })
      return
    }

    if (waitingForNewValue) {
      actions.updateComponentState<CalculatorState>(componentId, {
        display: num,
        waitingForNewValue: false,
      })
    } else {
      actions.updateComponentState<CalculatorState>(componentId, {
        display: display === '0' ? num : display + num,
      })
    }
  }, [workspaceId, componentId, waitingForNewValue, display, actions])

  const inputDecimal = useCallback(() => {
    if (!workspaceId) return

    if (waitingForNewValue) {
      actions.updateComponentState<CalculatorState>(componentId, {
        display: '0.',
        waitingForNewValue: false,
      })
    } else if (display.indexOf('.') === -1) {
      actions.updateComponentState<CalculatorState>(componentId, {
        display: display + '.',
      })
    }
  }, [workspaceId, componentId, waitingForNewValue, display, actions])

  const clear = useCallback(() => {
    if (!workspaceId) return

    actions.updateComponentState<CalculatorState>(componentId, {
      display: '0',
      previousValue: null,
      operation: null,
      waitingForNewValue: false,
    })
  }, [workspaceId, componentId, actions])

  const calculate = (firstValue: number, secondValue: number, op: string): number => {
    switch (op) {
      case '+': return firstValue + secondValue
      case '-': return firstValue - secondValue
      case '*': return firstValue * secondValue
      case '/': return firstValue / secondValue
      case '=': return secondValue
      default: return secondValue
    }
  }

  const performOperation = useCallback((nextOperation: string) => {
    if (!workspaceId) return

    const inputValue = parseFloat(display)

    if (previousValue === null) {
      actions.updateComponentState<CalculatorState>(componentId, {
        previousValue: inputValue,
        waitingForNewValue: true,
        operation: nextOperation,
      })
    } else if (operation) {
      const currentValue = previousValue || 0
      const newValue = calculate(currentValue, inputValue, operation)
      actions.updateComponentState<CalculatorState>(componentId, {
        display: String(newValue),
        previousValue: newValue,
        waitingForNewValue: true,
        operation: nextOperation,
      })
    } else {
      actions.updateComponentState<CalculatorState>(componentId, {
        waitingForNewValue: true,
        operation: nextOperation,
      })
    }
  }, [workspaceId, componentId, display, previousValue, operation, actions])

  const handleNegate = useCallback(() => {
    if (!workspaceId) return
    actions.updateComponentState<CalculatorState>(componentId, {
      display: String(-parseFloat(display)),
    })
  }, [workspaceId, componentId, display, actions])

  const handlePercent = useCallback(() => {
    if (!workspaceId) return
    actions.updateComponentState<CalculatorState>(componentId, {
      display: String(parseFloat(display) / 100),
    })
  }, [workspaceId, componentId, display, actions])

  const buttons = [
    ['C', '±', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '+'],
    ['0', '.', '=']
  ]

  return (
    <div className="calculator-component p-4 bg-gray-900 rounded-lg">
      <div className="flex items-center mb-3">
        <CalcIcon size={16} className="text-blue-400 mr-2" />
        <span className="text-xs text-gray-400">Calculator</span>
      </div>
      
      <div className="bg-gray-800 p-3 rounded mb-3">
        <div className="text-right text-2xl font-mono text-white overflow-hidden">
          {display}
        </div>
      </div>
      
      <div className="grid gap-2">
        {buttons.map((row, rowIndex) => (
          <div key={rowIndex} className={`grid gap-2 ${row.length === 3 ? 'grid-cols-4' : 'grid-cols-4'}`}>
            {row.map((btn) => (
              <button
                key={btn}
                onClick={() => {
                  if (btn === 'C') clear()
                  else if (btn === '±') handleNegate()
                  else if (btn === '%') handlePercent()
                  else if (btn === '.') inputDecimal()
                  else if (['+', '-', '×', '÷', '='].includes(btn)) {
                    const op = btn === '×' ? '*' : btn === '÷' ? '/' : btn
                    performOperation(op)
                  }
                  else inputNumber(btn)
                }}
                className={`
                  py-3 px-2 rounded font-semibold text-white
                  ${btn === '0' ? 'col-span-2' : ''}
                  ${['+', '-', '×', '÷', '='].includes(btn) 
                    ? 'bg-blue-600 hover:bg-blue-700' 
                    : btn === 'C' || btn === '±' || btn === '%'
                    ? 'bg-gray-700 hover:bg-gray-600'
                    : 'bg-gray-600 hover:bg-gray-500'}
                  transition-colors active:scale-95
                `}
              >
                {btn}
              </button>
            ))}
          </div>
        ))}
      </div>
      
      {/* TEST BUTTON: For testing isolation */}
      <button
        onClick={makeUnresponsive}
        className="w-full mt-2 py-2 px-3 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
        title="Test: Make calculator unresponsive for 5 seconds"
      >
        🧪 Test Hang (5s)
      </button>
    </div>
  )
}
