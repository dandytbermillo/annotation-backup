"use client"

import { useEffect, useState } from 'react'
import { Z_INDEX } from '@/lib/constants/z-index'

export function PersistenceMonitor() {
  const [persistCalls, setPersistCalls] = useState(0)
  const [lastPersist, setLastPersist] = useState<string>('')
  const [isMonitoring, setIsMonitoring] = useState(false)

  useEffect(() => {
    if (!isMonitoring) return

    // Intercept fetch to monitor persistence calls
    const originalFetch = window.fetch
    let callCount = 0

    window.fetch = function(...args) {
      const url = args[0] as string
      
      if (url && url.includes('/api/persistence/persist')) {
        callCount++
        const now = new Date()
        
        console.log(`📤 PostgreSQL persist call #${callCount} at ${now.toLocaleTimeString()}`)
        
        setPersistCalls(callCount)
        setLastPersist(now.toLocaleTimeString())
        
        // Log request details
        if (args[1] && (args[1] as any).body) {
          try {
            const body = JSON.parse((args[1] as any).body)
            console.log('   Doc:', body.docName)
            console.log('   Update size:', body.update ? body.update.length : 0)
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
      
      return originalFetch.apply(this, args)
    }

    // Restore original fetch on cleanup
    return () => {
      window.fetch = originalFetch
    }
  }, [isMonitoring])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        background: 'black',
        color: 'white',
        padding: '10px 15px',
        borderRadius: '8px',
        fontSize: '12px',
        zIndex: Z_INDEX.TOAST,
        minWidth: '200px',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>
        PostgreSQL Persistence Monitor
      </div>
      
      <button
        onClick={() => setIsMonitoring(!isMonitoring)}
        style={{
          background: isMonitoring ? '#4CAF50' : '#666',
          color: 'white',
          border: 'none',
          padding: '5px 10px',
          borderRadius: '4px',
          marginBottom: '10px',
          cursor: 'pointer',
          width: '100%'
        }}
      >
        {isMonitoring ? 'Monitoring Active' : 'Start Monitoring'}
      </button>
      
      {isMonitoring && (
        <>
          <div>Persist calls: <strong>{persistCalls}</strong></div>
          <div>Last persist: <strong>{lastPersist || 'None yet'}</strong></div>
          
          {persistCalls === 0 && (
            <div style={{ marginTop: '10px', color: '#ff6b6b' }}>
              ⚠️ No persistence detected yet
            </div>
          )}
          
          {persistCalls > 0 && (
            <div style={{ marginTop: '10px', color: '#51cf66' }}>
              ✅ Persisting to PostgreSQL!
            </div>
          )}
        </>
      )}
      
      <div style={{ marginTop: '10px', fontSize: '10px', opacity: 0.7 }}>
        Check console for details
      </div>
    </div>
  )
}
