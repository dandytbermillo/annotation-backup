"use client"

/**
 * Panel Size Picker
 * Part of Dashboard Implementation - Snap-to-Grid Feature
 *
 * Allows users to select from standard panel sizes.
 * Shows a visual grid of size options with the current size highlighted.
 * Uses fixed positioning to ensure dropdown is always on top of all panels.
 */

import React, { useState, useRef, useEffect } from 'react'
import { PANEL_SIZES, type PanelSizeKey, getPanelSizeKey } from '@/lib/dashboard/grid-snap'
import { Maximize2 } from 'lucide-react'

interface PanelSizePickerProps {
  currentWidth: number
  currentHeight: number
  onSizeChange: (sizeKey: PanelSizeKey, width: number, height: number) => void
  disabled?: boolean
}

export function PanelSizePicker({
  currentWidth,
  currentHeight,
  onSizeChange,
  disabled = false,
}: PanelSizePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Determine current size key
  const currentSizeKey = getPanelSizeKey(currentWidth, currentHeight)

  // Calculate dropdown position when opening
  const handleToggle = () => {
    if (disabled) return

    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const dropdownHeight = 180 // Approximate height of dropdown
      // Position dropdown above and aligned to the right edge of the button
      setDropdownPosition({
        top: rect.top - dropdownHeight - 8,
        left: rect.right - 180, // Align right edge (180px is dropdown width)
      })
    }
    setIsOpen(!isOpen)
  }

  // Close picker when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const handleSizeSelect = (sizeKey: PanelSizeKey) => {
    const size = PANEL_SIZES[sizeKey]
    onSizeChange(sizeKey, size.width, size.height)
    setIsOpen(false)
  }

  // Size options organized by visual layout (similar to HTML demo)
  const sizeOptions: { key: PanelSizeKey; cols: number; rows: number }[] = [
    { key: 'small', cols: 1, rows: 1 },
    { key: 'medium', cols: 2, rows: 1 },
    { key: 'wide', cols: 3, rows: 1 },
    { key: 'tall', cols: 1, rows: 2 },
    { key: 'large', cols: 2, rows: 2 },
    { key: 'xlarge', cols: 3, rows: 2 },
  ]

  return (
    <div className="relative">
      {/* Size picker trigger button */}
      <button
        ref={buttonRef}
        onClick={handleToggle}
        disabled={disabled}
        title="Change panel size"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 6,
          background: isOpen ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: isOpen ? '#818cf8' : '#8b8fa3',
          opacity: disabled ? 0.5 : 1,
          transition: 'all 150ms ease',
        }}
        onMouseEnter={(e) => {
          if (!disabled && !isOpen) {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
            e.currentTarget.style.color = '#a5b4fc'
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#8b8fa3'
          }
        }}
      >
        <Maximize2 size={14} />
      </button>

      {/* Size picker dropdown - uses fixed positioning to be above all panels */}
      {isOpen && dropdownPosition && (
        <div
          ref={pickerRef}
          style={{
            position: 'fixed',
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            padding: 12,
            background: 'rgba(15, 17, 23, 0.98)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            zIndex: 99999,
            width: 180,
          }}
        >
          {/* Header */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#8b8fa3',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 10,
            }}
          >
            Panel Size
          </div>

          {/* Size grid - visual representation */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gridTemplateRows: 'repeat(2, 1fr)',
              gap: 6,
              marginBottom: 12,
            }}
          >
            {sizeOptions.map(({ key, cols, rows }) => {
              const isSelected = currentSizeKey === key
              const size = PANEL_SIZES[key]

              return (
                <button
                  key={key}
                  onClick={() => handleSizeSelect(key)}
                  title={`${size.label} (${key})`}
                  style={{
                    gridColumn: `span ${cols}`,
                    gridRow: `span ${rows}`,
                    minHeight: rows === 1 ? 32 : 70,
                    borderRadius: 6,
                    border: isSelected
                      ? '2px solid #818cf8'
                      : '1px solid rgba(255, 255, 255, 0.1)',
                    background: isSelected
                      ? 'rgba(99, 102, 241, 0.15)'
                      : 'rgba(255, 255, 255, 0.03)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 500,
                    color: isSelected ? '#a5b4fc' : '#6b7280',
                    transition: 'all 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)'
                      e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)'
                      e.currentTarget.style.color = '#a5b4fc'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
                      e.currentTarget.style.color = '#6b7280'
                    }
                  }}
                >
                  {size.label}
                </button>
              )
            })}
          </div>

          {/* Current size indicator */}
          <div
            style={{
              fontSize: 11,
              color: '#6b7280',
              textAlign: 'center',
              paddingTop: 8,
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            Current: {currentSizeKey ? PANEL_SIZES[currentSizeKey].label : 'Custom'}
          </div>
        </div>
      )}
    </div>
  )
}
