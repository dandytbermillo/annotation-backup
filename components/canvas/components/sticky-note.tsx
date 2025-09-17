"use client"

import React, { useState, useRef, useEffect } from 'react'

interface StickyNoteProps {
  componentId: string
  state?: any
  onStateUpdate?: (state: any) => void
}

const STICKY_COLORS = [
  { name: 'yellow', bg: '#fef08a', border: '#fde047', text: '#713f12', shadow: 'rgba(254, 240, 138, 0.4)' },
  { name: 'pink', bg: '#fbcfe8', border: '#f9a8d4', text: '#831843', shadow: 'rgba(251, 207, 232, 0.4)' },
  { name: 'blue', bg: '#bfdbfe', border: '#93c5fd', text: '#1e3a8a', shadow: 'rgba(191, 219, 254, 0.4)' },
  { name: 'green', bg: '#bbf7d0', border: '#86efac', text: '#14532d', shadow: 'rgba(187, 247, 208, 0.4)' },
  { name: 'purple', bg: '#e9d5ff', border: '#d8b4fe', text: '#581c87', shadow: 'rgba(233, 213, 255, 0.4)' },
  { name: 'orange', bg: '#fed7aa', border: '#fdba74', text: '#7c2d12', shadow: 'rgba(254, 215, 170, 0.4)' },
]

export function StickyNote({ componentId, state, onStateUpdate }: StickyNoteProps) {
  const [content, setContent] = useState(state?.content || '')
  const [colorIndex, setColorIndex] = useState(state?.colorIndex || 0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const currentColor = STICKY_COLORS[colorIndex]

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [content])

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setContent(newContent)
    onStateUpdate?.({ content: newContent, colorIndex })
  }

  const cycleColor = () => {
    const newIndex = (colorIndex + 1) % STICKY_COLORS.length
    setColorIndex(newIndex)
    onStateUpdate?.({ content, colorIndex: newIndex })
  }

  return (
    <div 
      className="sticky-note-component relative flex flex-col"
      style={{
        backgroundColor: currentColor.bg,
        borderRadius: '2px',
        boxShadow: `0 4px 6px -1px ${currentColor.shadow}, 0 2px 4px -1px rgba(0, 0, 0, 0.06)`,
        minHeight: '250px',
        width: '100%',
        transform: 'rotate(-1deg)',
      }}
    >
      {/* Drag handle header */}
      <div 
        className="flex items-center justify-between px-4 py-2 cursor-grab select-none"
        data-sticky-note-drag-handle
        style={{
          color: currentColor.text,
          borderBottom: `1px solid ${currentColor.border}`,
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
          fontWeight: 600,
          fontSize: '13px',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        <span>Sticky Note</span>
        <button
          onClick={cycleColor}
          className="relative w-6 h-6 rounded-full opacity-70 hover:opacity-100 transition-opacity"
          style={{
            backgroundColor: STICKY_COLORS[(colorIndex + 1) % STICKY_COLORS.length].bg,
            border: `2px solid ${STICKY_COLORS[(colorIndex + 1) % STICKY_COLORS.length].border}`,
          }}
          title="Change color"
        />
      </div>
      
      {/* Main textarea */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleContentChange}
        className="w-full flex-1 bg-transparent resize-none focus:outline-none px-4 py-4"
        style={{
          color: currentColor.text,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '14px',
          lineHeight: '1.8',
          minHeight: '200px',
          fontWeight: '500',
        }}
        placeholder="Write a note..."
      />
      
      {/* Character count - subtle, bottom corner */}
      <div 
        className="absolute bottom-2 left-4 text-xs opacity-40"
        style={{ color: currentColor.text }}
      >
        {content.length > 0 && `${content.length} chars`}
      </div>
    </div>
  )
}