"use client"

import React from 'react'
import { Calculator, Timer, StickyNote, MousePointer2 } from 'lucide-react'

interface AddComponentMenuProps {
  visible: boolean
  onClose: () => void
  onAddComponent: (type: string, position?: { x: number; y: number }) => void
}

export function AddComponentMenu({ visible, onClose, onAddComponent }: AddComponentMenuProps) {
  if (!visible) return null

  const componentOptions = [
    {
      type: 'calculator',
      label: 'Add Calculator',
      icon: Calculator,
      color: 'from-blue-500 to-blue-600'
    },
    {
      type: 'timer', 
      label: 'Add Timer',
      icon: Timer,
      color: 'from-green-500 to-green-600'
    },
    {
      type: 'sticky-note',
      label: 'Add Sticky Note',
      icon: StickyNote,
      color: 'from-yellow-500 to-yellow-600'
    },
    {
      type: 'dragtest',
      label: 'Add Drag Test',
      icon: MousePointer2,
      color: 'from-orange-500 to-orange-600'
    }
  ]

  const handleComponentClick = (type: string) => {
    // Simply pass the type and let the parent handle positioning
    // The parent component has access to the actual canvas state
    onAddComponent(type)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-[999] backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Menu */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[1000]">
        <div className="bg-gray-900 rounded-2xl shadow-2xl p-6 border border-gray-800">
          <h2 className="text-xl font-bold text-white mb-6">Add Components</h2>
          
          <div className="grid grid-cols-2 gap-4">
            {componentOptions.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.type}
                  onClick={() => handleComponentClick(option.type)}
                  className={`
                    relative overflow-hidden rounded-xl p-6
                    bg-gradient-to-br ${option.color}
                    text-white font-semibold
                    transform transition-all duration-200
                    hover:scale-105 hover:shadow-xl
                    active:scale-95
                    flex flex-col items-center justify-center
                    min-w-[180px] min-h-[120px]
                    group
                  `}
                >
                  <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <Icon size={32} className="mb-3" />
                  <span className="text-sm">{option.label}</span>
                </button>
              )
            })}
          </div>
          
          <button
            onClick={onClose}
            className="mt-6 w-full py-2 px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}