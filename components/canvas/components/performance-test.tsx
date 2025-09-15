"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Activity } from 'lucide-react'

interface PerformanceTestProps {
  componentId: string
}

export function PerformanceTest({ componentId }: PerformanceTestProps) {
  const [intensity, setIntensity] = useState(0)
  const [particles, setParticles] = useState<Array<{x: number, y: number, vx: number, vy: number}>>([])
  const animationRef = useRef<number>()
  const intensityRef = useRef<number>(0)
  
  // Track intensity in ref to avoid closure issues
  useEffect(() => {
    intensityRef.current = intensity
  }, [intensity])
  
  // Create performance issues without blocking
  useEffect(() => {
    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = undefined
    }
    
    if (intensity === 0) {
      setParticles([])
      return
    }
    
    // Create particles based on intensity
    const newParticles = Array.from({length: intensity * 50}, () => ({
      x: Math.random() * 300,
      y: Math.random() * 200,
      vx: (Math.random() - 0.5) * 4, // Increased speed
      vy: (Math.random() - 0.5) * 4
    }))
    setParticles(newParticles)
    
    // Animate particles (causes render load)
    const animate = () => {
      // Use ref to get current intensity value
      if (intensityRef.current > 0) {
        setParticles(prev => prev.map(p => ({
          x: (p.x + p.vx + 300) % 300,
          y: (p.y + p.vy + 200) % 200,
          vx: p.vx,
          vy: p.vy
        })))
        animationRef.current = requestAnimationFrame(animate)
      }
    }
    
    // Start animation
    animationRef.current = requestAnimationFrame(animate)
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = undefined
      }
    }
  }, [intensity])
  
  // Heavy DOM manipulation based on intensity
  const heavyDOMWork = useCallback(() => {
    const container = document.getElementById(`perf-test-${componentId}`)
    if (!container) return
    
    // Use intensityRef to get current value
    const currentIntensity = intensityRef.current
    
    for (let i = 0; i < currentIntensity * 20; i++) { // Increased multiplier
      const div = document.createElement('div')
      div.className = 'perf-particle'
      div.style.position = 'absolute'
      div.style.width = '3px'
      div.style.height = '3px'
      div.style.background = `hsl(${Math.random() * 360}, 100%, 50%)`
      div.style.left = `${Math.random() * 100}%`
      div.style.top = `${Math.random() * 100}%`
      div.style.borderRadius = '50%'
      div.style.boxShadow = '0 0 2px currentColor'
      container.appendChild(div)
      
      // Remove after a short time to prevent memory leak
      setTimeout(() => {
        if (div.parentNode) div.remove()
      }, 200) // Increased lifetime
    }
  }, [componentId])
  
  useEffect(() => {
    if (intensity >= 3) {
      const interval = setInterval(heavyDOMWork, 50) // More frequent updates
      return () => clearInterval(interval)
    }
  }, [intensity, heavyDOMWork])
  
  return (
    <div className="bg-gray-900 p-4 rounded">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="text-yellow-400" size={20} />
        <span className="text-white font-semibold">Performance Test</span>
      </div>
      
      {/* Particle animation area */}
      <div 
        id={`perf-test-${componentId}`}
        className="relative w-full h-48 bg-gray-800 rounded mb-3 overflow-hidden"
        style={{ position: 'relative' }}
      >
        {particles.map((p, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${p.x}px`,
              top: `${p.y}px`,
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              background: `hsl(${(p.x + p.y) % 360}, 100%, 50%)`,
              boxShadow: '0 0 4px currentColor'
            }}
          />
        ))}
      </div>
      
      {/* Intensity controls */}
      <div className="space-y-2">
        <div className="text-xs text-gray-400">
          Load Intensity: {intensity === 0 ? 'Off' : `${intensity}/5`}
        </div>
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4, 5].map(level => (
            <button
              key={level}
              onClick={() => setIntensity(level)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                intensity === level
                  ? level === 0 ? 'bg-green-600 text-white' 
                    : level <= 2 ? 'bg-yellow-600 text-white'
                    : 'bg-red-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {level === 0 ? 'Off' : level}
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-500 mt-2">
          • Level 1-2: Light load (FPS ~45-60)<br/>
          • Level 3-4: Moderate load (FPS ~25-45)<br/>
          • Level 5: Heavy load (FPS ~10-25)<br/>
          <span className="text-yellow-400">
            Watch FPS drop and auto-isolation trigger!
          </span>
        </div>
      </div>
    </div>
  )
}