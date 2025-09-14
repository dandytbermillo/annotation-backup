"use client"

import React, { useState } from 'react'
import { Calculator as CalcIcon } from 'lucide-react'

interface CalculatorProps {
  componentId: string
  state?: any
  onStateUpdate?: (state: any) => void
}

export function Calculator({ componentId, state, onStateUpdate }: CalculatorProps) {
  const [display, setDisplay] = useState(state?.display || '0')
  const [previousValue, setPreviousValue] = useState(state?.previousValue || null)
  const [operation, setOperation] = useState(state?.operation || null)
  const [waitingForNewValue, setWaitingForNewValue] = useState(false)

  const inputNumber = (num: string) => {
    if (waitingForNewValue) {
      setDisplay(num)
      setWaitingForNewValue(false)
    } else {
      setDisplay(display === '0' ? num : display + num)
    }
  }

  const inputDecimal = () => {
    if (waitingForNewValue) {
      setDisplay('0.')
      setWaitingForNewValue(false)
    } else if (display.indexOf('.') === -1) {
      setDisplay(display + '.')
    }
  }

  const clear = () => {
    setDisplay('0')
    setPreviousValue(null)
    setOperation(null)
    setWaitingForNewValue(false)
  }

  const performOperation = (nextOperation: string) => {
    const inputValue = parseFloat(display)

    if (previousValue === null) {
      setPreviousValue(inputValue)
    } else if (operation) {
      const currentValue = previousValue || 0
      const newValue = calculate(currentValue, inputValue, operation)
      setDisplay(String(newValue))
      setPreviousValue(newValue)
    }

    setWaitingForNewValue(true)
    setOperation(nextOperation)
  }

  const calculate = (firstValue: number, secondValue: number, operation: string) => {
    switch (operation) {
      case '+': return firstValue + secondValue
      case '-': return firstValue - secondValue
      case '*': return firstValue * secondValue
      case '/': return firstValue / secondValue
      case '=': return secondValue
      default: return secondValue
    }
  }

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
                  else if (btn === '±') setDisplay(String(-parseFloat(display)))
                  else if (btn === '%') setDisplay(String(parseFloat(display) / 100))
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
    </div>
  )
}