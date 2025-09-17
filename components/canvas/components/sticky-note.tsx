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
      className="sticky-note-component relative flex flex-col p-4"
      style={{
        backgroundColor: currentColor.bg,
        minHeight: '250px',
        width: '100%',
        boxShadow: '2px 2px 8px rgba(0, 0, 0, 0.15)',
      }}
    >
      {/* Color switcher button in corner */}
      <button
        onClick={cycleColor}
        className="absolute top-2 right-2 w-4 h-4 rounded-full opacity-50 hover:opacity-100 transition-opacity"
        style={{
          backgroundColor: STICKY_COLORS[(colorIndex + 1) % STICKY_COLORS.length].bg,
          border: `1px solid ${STICKY_COLORS[(colorIndex + 1) % STICKY_COLORS.length].border}`,
        }}
        title="Change color"
      />
      
      {/* Main textarea - looks like handwritten note */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleContentChange}
        className="w-full flex-1 bg-transparent resize-none focus:outline-none"
        style={{
          color: currentColor.text,
          fontFamily: '"Marker Felt", "Comic Sans MS", cursive',
          fontSize: '16px',
          lineHeight: '1.8',
          minHeight: '200px',
        }}
        placeholder="Write a note..."
      />
      
      {/* Character count - subtle, bottom corner */}
      <div 
        className="absolute bottom-2 left-2 text-xs opacity-30"
        style={{ color: currentColor.text }}
      >
        {content.length > 0 && `${content.length}`}
      </div>
    </div>
  )
}