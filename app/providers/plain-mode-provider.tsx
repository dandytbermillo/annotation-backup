'use client'

import { useEffect } from 'react'
import { initializePlainProvider } from '@/lib/provider-switcher'
import { WebPostgresOfflineAdapter } from '@/lib/adapters/web-postgres-offline-adapter'
import { ensureFailClosed, getCollabMode, lockPlainMode } from '@/lib/collab-mode'

export function PlainModeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Check if we're in browser environment
    if (typeof window === 'undefined') return
    
    // Establish fail-closed plain behavior and set lock (query/env/default)
    ensureFailClosed()
    const collabMode = getCollabMode()
    
    if (collabMode === 'plain') {
      // If we reached plain due to transient state, ensure lock persists
      lockPlainMode('runtime')
      console.log('[PlainModeProvider] Detected plain mode, initializing...')
      // Check if we're in Electron
      if (window.electronAPI) {
        // Dynamic import for Electron adapter
        import('@/lib/adapters/electron-postgres-offline-adapter').then(({ ElectronPostgresOfflineAdapter }) => {
          const adapter = new ElectronPostgresOfflineAdapter()
          initializePlainProvider(adapter)
          console.log('[PlainModeProvider] ✅ Initialized plain mode with Electron adapter')
        })
      } else {
        // Use web adapter
        const adapter = new WebPostgresOfflineAdapter()
        initializePlainProvider(adapter)
        console.log('[PlainModeProvider] ✅ Initialized plain mode with Web adapter')
      }
    } else {
      console.log('[PlainModeProvider] Not in plain mode, skipping initialization. Mode:', collabMode)
    }
  }, [])
  
  return <>{children}</>
}
