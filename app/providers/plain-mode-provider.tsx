'use client'

import { useEffect } from 'react'
import { initializePlainProvider } from '@/lib/provider-switcher'
import { WebPostgresOfflineAdapter } from '@/lib/adapters/web-postgres-offline-adapter'

export function PlainModeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Check if we're in browser environment
    if (typeof window === 'undefined') return
    
    const collabMode = process.env.NEXT_PUBLIC_COLLAB_MODE || 
                       localStorage.getItem('collab-mode') || 
                       'yjs'
    
    if (collabMode === 'plain') {
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