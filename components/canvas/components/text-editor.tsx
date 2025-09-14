"use client"

import React, { useState } from 'react'
import { FileText, Bold, Italic, Underline, List, ListOrdered, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'

interface TextEditorProps {
  componentId: string
  state?: any
  onStateUpdate?: (state: any) => void
}

export function TextEditor({ componentId, state, onStateUpdate }: TextEditorProps) {
  const [content, setContent] = useState(state?.content || '')
  const [fontSize, setFontSize] = useState(state?.fontSize || '14')
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)

  const handleFormatting = (format: string) => {
    // In a real implementation, this would apply formatting to selected text
    switch(format) {
      case 'bold':
        setIsBold(!isBold)
        break
      case 'italic':
        setIsItalic(!isItalic)
        break
      case 'underline':
        setIsUnderline(!isUnderline)
        break
    }
  }

  const textStyle = {
    fontWeight: isBold ? 'bold' : 'normal',
    fontStyle: isItalic ? 'italic' : 'normal',
    textDecoration: isUnderline ? 'underline' : 'none',
    fontSize: `${fontSize}px`
  }

  return (
    <div className="text-editor-component bg-gray-900 rounded-lg overflow-hidden">
      <div className="flex items-center px-4 py-2 bg-gray-800 border-b border-gray-700">
        <FileText size={16} className="text-purple-400 mr-2" />
        <span className="text-xs text-gray-400">Text Editor</span>
      </div>
      
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-2 bg-gray-850 border-b border-gray-700">
        <button
          onClick={() => handleFormatting('bold')}
          className={`p-1.5 rounded hover:bg-gray-700 transition-colors ${isBold ? 'bg-gray-700' : ''}`}
        >
          <Bold size={16} className="text-gray-300" />
        </button>
        <button
          onClick={() => handleFormatting('italic')}
          className={`p-1.5 rounded hover:bg-gray-700 transition-colors ${isItalic ? 'bg-gray-700' : ''}`}
        >
          <Italic size={16} className="text-gray-300" />
        </button>
        <button
          onClick={() => handleFormatting('underline')}
          className={`p-1.5 rounded hover:bg-gray-700 transition-colors ${isUnderline ? 'bg-gray-700' : ''}`}
        >
          <Underline size={16} className="text-gray-300" />
        </button>
        
        <div className="w-px h-5 bg-gray-700 mx-1" />
        
        <button className="p-1.5 rounded hover:bg-gray-700 transition-colors">
          <List size={16} className="text-gray-300" />
        </button>
        <button className="p-1.5 rounded hover:bg-gray-700 transition-colors">
          <ListOrdered size={16} className="text-gray-300" />
        </button>
        
        <div className="w-px h-5 bg-gray-700 mx-1" />
        
        <button className="p-1.5 rounded hover:bg-gray-700 transition-colors">
          <AlignLeft size={16} className="text-gray-300" />
        </button>
        <button className="p-1.5 rounded hover:bg-gray-700 transition-colors">
          <AlignCenter size={16} className="text-gray-300" />
        </button>
        <button className="p-1.5 rounded hover:bg-gray-700 transition-colors">
          <AlignRight size={16} className="text-gray-300" />
        </button>
        
        <div className="w-px h-5 bg-gray-700 mx-1" />
        
        <select 
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
          className="px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 hover:bg-gray-700"
        >
          <option value="12">12px</option>
          <option value="14">14px</option>
          <option value="16">16px</option>
          <option value="18">18px</option>
          <option value="20">20px</option>
          <option value="24">24px</option>
        </select>
      </div>
      
      {/* Editor area */}
      <div className="p-3">
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            onStateUpdate?.({ content: e.target.value, fontSize })
          }}
          style={textStyle}
          className="w-full h-48 p-3 bg-gray-800 text-white rounded resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
          placeholder="Start typing..."
        />
      </div>
      
      {/* Status bar */}
      <div className="px-4 py-2 bg-gray-800 border-t border-gray-700 text-xs text-gray-400">
        {content.length} characters | {content.split(/\s+/).filter(w => w.length > 0).length} words
      </div>
    </div>
  )
}