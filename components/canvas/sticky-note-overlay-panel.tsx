"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { StickyNote } from './components/sticky-note'

interface StickyNoteOverlayPanelProps {
  id: string
  position: { x: number; y: number }
  onClose?: (id: string) => void
  onPositionChange?: (id: string, position: { x: number; y: number }) => void
}

export function StickyNoteOverlayPanel({
  id,
  position,
  onClose,
  onPositionChange,
}: StickyNoteOverlayPanelProps) {
  const [componentState, setComponentState] = useState({})
  const [screenPosition, setScreenPosition] = useState(position)
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    originX: position.x,
    originY: position.y,
  })

  useEffect(() => {
    if (!dragState.current.isDragging) {
      setScreenPosition(position)
      dragState.current.originX = position.x
      dragState.current.originY = position.y
    }
  }, [position.x, position.y])

  const stopDragging = useCallback(
    (event: MouseEvent) => {
      if (!dragState.current.isDragging) return

      const deltaX = event.clientX - dragState.current.startX
      const deltaY = event.clientY - dragState.current.startY
      const finalPosition = {
        x: dragState.current.originX + deltaX,
        y: dragState.current.originY + deltaY,
      }

      dragState.current.isDragging = false
      document.removeEventListener('mousemove', handleMove, true)
      document.removeEventListener('mouseup', stopDragging, true)
      document.body.style.userSelect = ''

      setScreenPosition(finalPosition)
      onPositionChange?.(id, finalPosition)
    },
    [id, onPositionChange]
  )

  const handleMove = useCallback((event: MouseEvent) => {
    if (!dragState.current.isDragging) return

    const deltaX = event.clientX - dragState.current.startX
    const deltaY = event.clientY - dragState.current.startY

    setScreenPosition({
      x: dragState.current.originX + deltaX,
      y: dragState.current.originY + deltaY,
    })
  }, [])

  const startDragging = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      dragState.current.isDragging = true
      dragState.current.startX = event.clientX
      dragState.current.startY = event.clientY
      dragState.current.originX = screenPosition.x
      dragState.current.originY = screenPosition.y

      document.addEventListener('mousemove', handleMove, true)
      document.addEventListener('mouseup', stopDragging, true)
      document.body.style.userSelect = 'none'
    },
    [handleMove, screenPosition.x, screenPosition.y, stopDragging]
  )

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (target.closest('textarea') || target.closest('button')) {
        return
      }

      event.preventDefault()
      startDragging(event)
    },
    [startDragging]
  )

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMove, true)
      document.removeEventListener('mouseup', stopDragging, true)
      document.body.style.userSelect = ''
    }
  }, [handleMove, stopDragging])

  return (
    <div
      style={{
        position: 'absolute',
        left: `${screenPosition.x}px`,
        top: `${screenPosition.y}px`,
        width: '280px',
        pointerEvents: 'auto',
      }}
      className="group"
      onMouseDown={handleMouseDown}
    >
      <button
        onClick={(event) => {
          event.stopPropagation()
          onClose?.(id)
        }}
        className="absolute -top-2 -right-2 z-10 bg-gray-800 hover:bg-gray-900 text-white rounded-full p-1 shadow transition-colors"
        aria-label="Close sticky note"
      >
        <X size={14} />
      </button>

      <StickyNote componentId={id} state={componentState} onStateUpdate={setComponentState} />
    </div>
  )
}
