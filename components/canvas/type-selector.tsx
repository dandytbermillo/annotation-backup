"use client"

import { useState, useRef, useEffect } from 'react'

export type AnnotationType = 'note' | 'explore' | 'promote'

interface TypeSelectorProps {
  currentType: AnnotationType
  onTypeChange: (newType: AnnotationType) => void
  disabled?: boolean
}

const TYPE_CONFIG = {
  note: { icon: '📝', label: 'Note', color: '#3498db' },
  explore: { icon: '🔍', label: 'Explore', color: '#f39c12' },
  promote: { icon: '⭐', label: 'Promote', color: '#27ae60' }
} as const

export function TypeSelector({ currentType, onTypeChange, disabled = false }: TypeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleTypeSelect = (type: AnnotationType) => {
    if (type !== currentType) {
      onTypeChange(type)
    }
    setIsOpen(false)
  }

  const current = TYPE_CONFIG[currentType]

  return (
    <div
      className="type-selector"
      ref={dropdownRef}
      style={{ position: 'relative' }}
    >
      <button
        className="type-badge"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 8px',
          borderRadius: '6px',
          border: '1px solid rgba(0,0,0,0.1)',
          background: 'white',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '13px',
          fontWeight: 500,
          opacity: disabled ? 0.6 : 1,
          transition: 'all 0.2s ease',
          boxShadow: isOpen ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
        }}
      >
        <span>{current.icon}</span>
        <span>{current.label}</span>
        {!disabled && <span style={{ fontSize: '9px', opacity: 0.6 }}>▼</span>}
      </button>

      {isOpen && (
        <div
          className="type-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            background: 'white',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 10000,
            minWidth: '140px',
            overflow: 'hidden'
          }}
        >
          {Object.entries(TYPE_CONFIG).map(([type, config]) => (
            <button
              key={type}
              onClick={() => handleTypeSelect(type as AnnotationType)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                border: 'none',
                background: type === currentType ? 'rgba(0,0,0,0.05)' : 'transparent',
                cursor: 'pointer',
                fontSize: '13px',
                textAlign: 'left',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => {
                if (type !== currentType) {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.03)'
                }
              }}
              onMouseLeave={(e) => {
                if (type !== currentType) {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <span>{config.icon}</span>
              <span style={{ flex: 1 }}>{config.label}</span>
              {type === currentType && <span style={{ color: '#27ae60', fontSize: '12px' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
