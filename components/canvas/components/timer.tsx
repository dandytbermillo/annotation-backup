"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Timer as TimerIcon, Play, Pause, RotateCcw } from 'lucide-react'

interface TimerProps {
  componentId: string
  state?: any
  onStateUpdate?: (state: any) => void
}

export function Timer({ componentId, state, onStateUpdate }: TimerProps) {
  const [minutes, setMinutes] = useState(state?.minutes || 5)
  const [seconds, setSeconds] = useState(state?.seconds || 0)
  const [isRunning, setIsRunning] = useState(state?.isRunning || false)
  const [inputMinutes, setInputMinutes] = useState('5')
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setSeconds(prev => {
          if (prev > 0) {
            return prev - 1
          } else if (minutes > 0) {
            setMinutes(m => m - 1)
            return 59
          } else {
            setIsRunning(false)
            // Timer complete
            return 0
          }
        })
      }, 1000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isRunning, minutes])

  const handleStart = () => {
    if (minutes === 0 && seconds === 0) {
      const mins = parseInt(inputMinutes) || 5
      setMinutes(mins)
      setSeconds(0)
    }
    setIsRunning(true)
  }

  const handlePause = () => {
    setIsRunning(false)
  }

  const handleReset = () => {
    setIsRunning(false)
    const mins = parseInt(inputMinutes) || 5
    setMinutes(mins)
    setSeconds(0)
  }

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
            onChange={(e) => setInputMinutes(e.target.value)}
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