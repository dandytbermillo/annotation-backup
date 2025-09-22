import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

// Define the schema for the collapsible block
export const CollapsibleBlock = Node.create({
  name: 'collapsibleBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  
  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      collapsed: {
        default: false,
        parseHTML: element => element.getAttribute('data-collapsed') === 'true',
        renderHTML: attributes => {
          return { 'data-collapsed': attributes.collapsed }
        },
      },
      title: {
        default: 'Section Title',
        parseHTML: element => element.getAttribute('data-title'),
        renderHTML: attributes => {
          return { 'data-title': attributes.title }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-collapsible-block]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-collapsible-block': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleBlockComponent)
  },

  addCommands() {
    return {
      insertCollapsibleBlock: () => ({ commands }) => {
        // Create the pre-filled content structure
        const content = {
          type: 'collapsibleBlock',
          attrs: {
            collapsed: false,
            title: 'Section Title'
          },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Description paragraph here...' }
              ]
            },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Main point 1' }]
                    }
                  ]
                },
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Main point 2' }]
                    },
                    {
                      type: 'bulletList',
                      content: [
                        {
                          type: 'listItem',
                          content: [
                            {
                              type: 'paragraph',
                              content: [{ type: 'text', text: 'Sub-point 2.1' }]
                            }
                          ]
                        },
                        {
                          type: 'listItem',
                          content: [
                            {
                              type: 'paragraph',
                              content: [{ type: 'text', text: 'Sub-point 2.2' }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Main point 3' }]
                    },
                    {
                      type: 'bulletList',
                      content: [
                        {
                          type: 'listItem',
                          content: [
                            {
                              type: 'paragraph',
                              content: [{ type: 'text', text: 'Sub-point 3.1' }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
        
        return commands.insertContent(content)
      },
    }
  },
})

// React component for the collapsible block
function CollapsibleBlockComponent({ node, updateAttributes, editor }: any) {
  const [isCollapsed, setIsCollapsed] = useState(node.attrs.collapsed)
  const [title, setTitle] = useState(node.attrs.title)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const [showPreviewIcon, setShowPreviewIcon] = useState(false)
  const iconRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [cachedContent, setCachedContent] = useState<string>('')
  const [cachedHtmlContent, setCachedHtmlContent] = useState<string>('')
  const [isTooltipHovered, setIsTooltipHovered] = useState(false)
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const toggleCollapse = () => {
    const newCollapsed = !isCollapsed
    
    // Cache content before collapsing
    if (!newCollapsed && contentRef.current) {
      const text = contentRef.current.textContent || ''
      setCachedContent(text.trim())
      const html = contentRef.current.innerHTML || ''
      setCachedHtmlContent(html)
    }
    
    setIsCollapsed(newCollapsed)
    updateAttributes({ collapsed: newCollapsed })
  }
  
  // Update cached content when expanded
  useEffect(() => {
    if (!isCollapsed && contentRef.current) {
      const text = contentRef.current.textContent || ''
      setCachedContent(text.trim())
      const html = contentRef.current.innerHTML || ''
      setCachedHtmlContent(html)
    }
  }, [isCollapsed])

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value)
  }

  const handleTitleBlur = () => {
    setIsEditingTitle(false)
    updateAttributes({ title })
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleTitleBlur()
    }
  }

  // Extract HTML content for tooltip display
  const getHtmlContent = () => {
    // First check if we have cached HTML
    if (cachedHtmlContent) {
      return cachedHtmlContent
    }
    
    // If not cached but content is expanded, get it from DOM
    if (!isCollapsed && contentRef.current) {
      const html = contentRef.current.innerHTML || ''
      setCachedHtmlContent(html) // Cache it for later
      return html
    }
    
    // Otherwise, we need to render the node content to HTML
    // This handles the case when block is collapsed from the start
    const renderNodeToHtml = (nodeData: any): string => {
      if (!nodeData) return ''
      
      if (typeof nodeData === 'string') return nodeData
      
      if (nodeData.text) {
        return nodeData.text
      }
      
      if (nodeData.type) {
        const type = nodeData.type.name || nodeData.type
        let content = ''
        
        if (nodeData.content) {
          if (Array.isArray(nodeData.content)) {
            content = nodeData.content.map((n: any) => renderNodeToHtml(n)).join('')
          } else if (nodeData.content.forEach) {
            // ProseMirror Fragment
            const parts: string[] = []
            nodeData.content.forEach((child: any) => {
              parts.push(renderNodeToHtml(child))
            })
            content = parts.join('')
          }
        }
        
        // Render based on node type
        switch (type) {
          case 'paragraph':
            return `<p>${content}</p>`
          case 'bulletList':
            return `<ul>${content}</ul>`
          case 'orderedList':
            return `<ol>${content}</ol>`
          case 'listItem':
            return `<li>${content}</li>`
          case 'heading':
            const level = nodeData.attrs?.level || 2
            return `<h${level}>${content}</h${level}>`
          case 'text':
            return content || nodeData.text || ''
          default:
            return content
        }
      }
      
      return ''
    }
    
    try {
      const html = renderNodeToHtml(node)
      if (html) {
        setCachedHtmlContent(html) // Cache for future use
        return html
      }
    } catch (error) {
      console.error('Error rendering node to HTML:', error)
    }
    
    return '<p style="color: #999; font-style: italic;">No content preview available</p>'
  }

  // Handle container hover
  const handleMouseEnter = () => {
    setIsHovered(true)
    if (isCollapsed) {
      setShowPreviewIcon(true)
    }
  }

  // Handle container mouse leave
  const handleMouseLeave = () => {
    setIsHovered(false)
    setShowPreviewIcon(false)
    setShowTooltip(false)
  }

  // Handle icon hover
  const handleIconMouseEnter = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = iconRef.current?.getBoundingClientRect()
    console.log('Icon hover - rect:', rect) // Debug log
    if (rect) {
      setTooltipPosition({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8
      })
      setShowTooltip(true)
      console.log('Tooltip should show at:', { x: rect.left + rect.width / 2, y: rect.bottom + 8 }) // Debug log
    }
  }

  // Handle icon mouse leave - add delay to allow moving to tooltip
  const handleIconMouseLeave = (e: React.MouseEvent) => {
    e.stopPropagation()
    
    // Set a timeout to hide tooltip, giving user time to move to it
    tooltipTimeoutRef.current = setTimeout(() => {
      if (!isTooltipHovered) {
        setShowTooltip(false)
      }
    }, 300) // 300ms delay to move to tooltip
  }
  
  // Handle tooltip mouse enter
  const handleTooltipMouseEnter = () => {
    setIsTooltipHovered(true)
    // Clear any pending hide timeout
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
  }
  
  // Handle tooltip mouse leave
  const handleTooltipMouseLeave = () => {
    console.log('Tooltip mouse leave - hiding tooltip') // Debug log
    setIsTooltipHovered(false)
    setShowTooltip(false)
  }
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current)
      }
    }
  }, [])

  return (
    <>
    <NodeViewWrapper 
      className="collapsible-block"
      style={{
        borderLeft: isCollapsed ? 'none' : `3px solid ${isHovered ? '#9b59b6' : '#e1e8ed'}`,
        borderRadius: '0',
        padding: isCollapsed ? '4px 0' : '4px 0 4px 12px',
        marginBottom: '12px',
        background: isCollapsed 
          ? (isHovered ? 'rgba(248, 249, 250, 0.3)' : 'transparent')
          : 'transparent',
        transition: 'all 0.2s ease',
        position: 'relative',
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: isCollapsed ? '0' : '12px',
          cursor: 'pointer',
          userSelect: 'none',
          padding: isCollapsed ? '2px 0' : '0',
        }}
      >
        <span 
          onClick={toggleCollapse}
          style={{
            fontSize: '16px',
            marginRight: '8px',
            transition: 'transform 0.2s ease',
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}
        >
          ▼
        </span>
        {isEditingTitle ? (
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            autoFocus
            style={{
              fontSize: '16px',
              fontWeight: '600',
              border: '1px solid #667eea',
              borderRadius: '4px',
              padding: '2px 6px',
              outline: 'none',
              background: 'white',
            }}
          />
        ) : (
          <span 
            onClick={(e) => {
              e.stopPropagation()
              setIsEditingTitle(true)
            }}
            style={{
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'text',
            }}
          >
            {title}
          </span>
        )}
        
        {/* Preview Icon - shows when collapsed and hovered */}
        {isCollapsed && showPreviewIcon && (
          <div
            ref={iconRef}
            onMouseEnter={handleIconMouseEnter}
            onMouseLeave={handleIconMouseLeave}
            style={{
              marginLeft: '8px',
              cursor: 'help',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              borderRadius: '4px',
              background: 'rgba(155, 89, 182, 0.1)',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(155, 89, 182, 0.2)'
              e.currentTarget.style.transform = 'scale(1.1)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(155, 89, 182, 0.1)'
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9b59b6" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
          </div>
        )}
      </div>
      
      {!isCollapsed && (
        <div 
          ref={contentRef}
          style={{
            paddingLeft: '20px',
            marginTop: '8px',
          }}
        >
          <NodeViewContent className="content" />
        </div>
      )}
    </NodeViewWrapper>
    
    {/* Tooltip - render with Portal to ensure it appears above everything */}
    {showTooltip && isCollapsed && typeof window !== 'undefined' && createPortal(
      <div
        className="annotation-tooltip visible"
        onMouseEnter={handleTooltipMouseEnter}
        onMouseLeave={handleTooltipMouseLeave}
        style={{
          position: 'fixed',
          left: `${tooltipPosition.x}px`,
          top: `${tooltipPosition.y}px`,
          transform: 'translateX(-50%)',
          background: 'white',
          border: '1px solid #e1e8ed',
          borderRadius: '8px',
          padding: '12px',
          maxWidth: '400px',
          maxHeight: '400px',
          overflowY: 'auto',
          overflowX: 'hidden',
          zIndex: 999999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          pointerEvents: 'auto', // Changed to auto to allow interaction
          userSelect: 'text', // Allow text selection
        }}
      >
        <div className="tooltip-header" style={{ 
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
          fontWeight: 600,
          color: '#333',
          borderBottom: '1px solid #e1e8ed',
          paddingBottom: '8px',
        }}>
          <span style={{ color: '#9b59b6' }}>▦</span>
          {title}
        </div>
        <div 
          className="tooltip-content"
          style={{ 
            color: '#666',
            fontSize: '14px',
            lineHeight: '1.6',
            maxHeight: '250px',
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: '8px',
          }}
          dangerouslySetInnerHTML={{ 
            __html: getHtmlContent()
          }}
        />
      </div>,
      document.body
    )}
    </>
  )
}