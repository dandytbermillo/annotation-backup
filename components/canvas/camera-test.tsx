"use client"

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { useAutoScroll } from './use-auto-scroll'

interface Camera {
  x: number
  y: number
  zoom: number
}

interface FakeNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  color: string
  label: string
}

export function CameraTest() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  
  // Camera state
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  
  // Fake nodes for testing
  const [nodes] = useState<FakeNode[]>([
    { id: '1', x: 100, y: 100, width: 200, height: 150, color: '#667eea', label: 'Panel 1' },
    { id: '2', x: 400, y: 200, width: 200, height: 150, color: '#3498db', label: 'Panel 2' },
    { id: '3', x: 250, y: 400, width: 200, height: 150, color: '#27ae60', label: 'Panel 3' },
  ])
  
  // Track which node is being dragged
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const dragState = useRef({
    startX: 0,
    startY: 0,
    nodeStartX: 0,
    nodeStartY: 0,
  })
  
  // Pan camera by screen delta
  const panCameraBy = useCallback((dxScreen: number, dyScreen: number) => {
    setCamera(prev => ({
      ...prev,
      // Important: divide by zoom to get world-space movement
      x: prev.x + dxScreen / prev.zoom,
      y: prev.y + dyScreen / prev.zoom,
    }))
  }, [])
  
  // Auto-scroll functionality
  const handleAutoScroll = useCallback((deltaX: number, deltaY: number) => {
    panCameraBy(deltaX, deltaY)
  }, [panCameraBy])
  
  const { checkAutoScroll, stopAutoScroll } = useAutoScroll({
    enabled: true,
    threshold: 80,
    speed: 8,
    onScroll: handleAutoScroll
  })
  
  // Handle node dragging
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    setDraggingNode(nodeId)
    
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeStartX: node.x,
      nodeStartY: node.y,
    }
  }
  
  // Handle canvas panning
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target !== canvasRef.current) return
    
    setDraggingNode('canvas')
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeStartX: camera.x,
      nodeStartY: camera.y,
    }
  }
  
  // Mouse move handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingNode) return
      
      if (draggingNode === 'canvas') {
        // Pan the camera
        const dx = e.clientX - dragState.current.startX
        const dy = e.clientY - dragState.current.startY
        
        setCamera({
          ...camera,
          x: dragState.current.nodeStartX + dx / camera.zoom,
          y: dragState.current.nodeStartY + dy / camera.zoom,
        })
      } else {
        // Check for auto-scroll when dragging nodes
        checkAutoScroll(e.clientX, e.clientY)
        
        // Move a node (in world space)
        const dx = (e.clientX - dragState.current.startX) / camera.zoom
        const dy = (e.clientY - dragState.current.startY) / camera.zoom
        
        const nodeIndex = nodes.findIndex(n => n.id === draggingNode)
        if (nodeIndex !== -1) {
          nodes[nodeIndex].x = dragState.current.nodeStartX + dx
          nodes[nodeIndex].y = dragState.current.nodeStartY + dy
          
          // Force re-render
          canvasRef.current?.setAttribute('data-update', Date.now().toString())
        }
      }
    }
    
    const handleMouseUp = () => {
      setDraggingNode(null)
      stopAutoScroll()
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggingNode, camera, nodes, checkAutoScroll, stopAutoScroll])
  
  // Handle zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setCamera(prev => ({
      ...prev,
      zoom: Math.max(0.5, Math.min(2, prev.zoom * delta))
    }))
  }
  
  // Compute canvas transform
  const canvasTransform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`
  
  return (
    <div 
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        background: '#f5f5f5',
        cursor: draggingNode === 'canvas' ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleCanvasMouseDown}
      onWheel={handleWheel}
    >
      {/* Camera info overlay */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        background: 'white',
        padding: '10px 15px',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        zIndex: 1000,
        fontFamily: 'monospace',
        fontSize: 14,
      }}>
        <div>Camera X: {camera.x.toFixed(1)}</div>
        <div>Camera Y: {camera.y.toFixed(1)}</div>
        <div>Zoom: {(camera.zoom * 100).toFixed(0)}%</div>
      </div>
      
      {/* Instructions */}
      <div style={{
        position: 'absolute',
        top: 20,
        right: 20,
        background: 'white',
        padding: '15px',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        zIndex: 1000,
        fontSize: 14,
        maxWidth: 300,
      }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: 16 }}>Camera Test POC</h3>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Drag nodes to move them</li>
          <li>Drag background to pan camera</li>
          <li>Scroll to zoom in/out</li>
          <li>Drag nodes to edges for auto-scroll</li>
        </ul>
      </div>
      
      {/* Canvas with camera transform */}
      <div 
        ref={canvasRef}
        id="infinite-canvas"
        style={{
          position: 'absolute',
          transform: canvasTransform,
          transformOrigin: '0 0',
          width: '100%',
          height: '100%',
        }}
      >
        {/* Render fake nodes */}
        {nodes.map(node => (
          <div
            key={node.id}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            style={{
              position: 'absolute',
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
              background: node.color,
              borderRadius: 12,
              padding: 20,
              color: 'white',
              cursor: draggingNode === node.id ? 'grabbing' : 'grab',
              userSelect: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {node.label}
          </div>
        ))}
      </div>
    </div>
  )
}