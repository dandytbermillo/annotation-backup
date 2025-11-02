"use client"

import { createContext, useContext } from 'react'
import { useConstellation } from '@/hooks/useConstellation'

export type ConstellationContextValue = ReturnType<typeof useConstellation>

const ConstellationContext = createContext<ConstellationContextValue | null>(null)

interface ConstellationProviderProps {
  children: React.ReactNode
}

export function ConstellationProvider({ children }: ConstellationProviderProps) {
  const value = useConstellation()
  return <ConstellationContext.Provider value={value}>{children}</ConstellationContext.Provider>
}

export function useConstellationContext(): ConstellationContextValue {
  const context = useContext(ConstellationContext)
  if (!context) {
    throw new Error('useConstellationContext must be used within a ConstellationProvider')
  }
  return context
}
