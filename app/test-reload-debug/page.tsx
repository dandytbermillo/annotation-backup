'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import { WebPostgresOfflineAdapter } from '@/lib/adapters/web-postgres-offline-adapter'
import { getSessionId } from '@/lib/debug-logger'

const TiptapEditorPlain = dynamic(
  () => import('@/components/canvas/tiptap-editor-plain'),
  { ssr: false }
)

export default function TestReloadDebugPage() {
  const [provider, setProvider] = useState<PlainOfflineProvider | null>(null)
  const [debugLogs, setDebugLogs] = useState<any[]>([])
  const [noteId] = useState('test-debug-note')
  const panelId = 'main'
  const [reloadCount, setReloadCount] = useState(0)
  const [isSimulating, setIsSimulating] = useState(false)
  const sessionId = getSessionId()
  
  // Initialize provider
  useEffect(() => {
    const adapter = new WebPostgresOfflineAdapter()
    const newProvider = new PlainOfflineProvider(adapter)
    setProvider(newProvider)
    console.log('Provider initialized for session:', sessionId)
  }, [])
  
  // Fetch debug logs
  const fetchDebugLogs = async () => {
    try {
      const response = await fetch('/api/debug/log')
      if (response.ok) {
        const logs = await response.json()
        setDebugLogs(logs)
      }
    } catch (error) {
      console.error('Failed to fetch debug logs:', error)
    }
  }
  
  // Auto-refresh logs
  useEffect(() => {
    fetchDebugLogs()
    const interval = setInterval(fetchDebugLogs, 2000)
    return () => clearInterval(interval)
  }, [])
  
  const clearDebugLogs = async () => {
    try {
      await fetch('/api/debug/clear', { method: 'POST' })
      setDebugLogs([])
    } catch (error) {
      console.error('Failed to clear debug logs:', error)
    }
  }
  
  const simulateScenario = async () => {
    if (!provider) return
    
    setIsSimulating(true)
    console.log('=== SIMULATING DOUBLE RELOAD SCENARIO ===')
    
    // Step 1: Save initial content
    const initialContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Initial content at ' + new Date().toISOString() }] }
      ]
    }
    
    await provider.saveDocument(noteId, panelId, initialContent as any, false)
    console.log('Initial content saved')
    
    // Step 2: Create stale localStorage backup
    const pendingKey = `pending_save_${noteId}_${panelId}`
    const staleContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'STALE content from old visibility change' }] }
      ]
    }
    
    localStorage.setItem(pendingKey, JSON.stringify({
      content: staleContent,
      timestamp: Date.now() - 30000, // 30 seconds ago
      noteId,
      panelId
    }))
    console.log('Stale localStorage backup created')
    
    // Step 3: Save new content
    const newContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'NEW content at ' + new Date().toISOString() }] }
      ]
    }
    
    await provider.saveDocument(noteId, panelId, newContent as any, false)
    console.log('New content saved')
    
    // Step 4: Trigger component reload
    setReloadCount(prev => prev + 1)
    
    setTimeout(() => {
      setIsSimulating(false)
      console.log('Scenario complete - check debug logs')
    }, 2000)
  }
  
  const clearLocalStorage = () => {
    const pendingKey = `pending_save_${noteId}_${panelId}`
    localStorage.removeItem(pendingKey)
    console.log('localStorage cleared')
  }
  
  // Filter logs for this session
  const sessionLogs = debugLogs.filter(log => log.session_id === sessionId)
  
  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <h1>Debug Reload Issue Test</h1>
      <p>Session ID: {sessionId}</p>
      
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <button 
          onClick={simulateScenario}
          disabled={!provider || isSimulating}
          style={{
            padding: '10px 20px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: provider && !isSimulating ? 'pointer' : 'not-allowed'
          }}
        >
          {isSimulating ? 'Simulating...' : 'Simulate Scenario'}
        </button>
        
        <button 
          onClick={clearLocalStorage}
          style={{
            padding: '10px 20px',
            background: '#FF9800',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear localStorage
        </button>
        
        <button 
          onClick={clearDebugLogs}
          style={{
            padding: '10px 20px',
            background: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear Debug Logs
        </button>
        
        <button 
          onClick={fetchDebugLogs}
          style={{
            padding: '10px 20px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Refresh Logs
        </button>
        
        <span>Reload count: {reloadCount}</span>
      </div>
      
      <div style={{ display: 'flex', gap: '20px', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h3>Editor</h3>
          <div style={{ 
            border: '2px solid #ccc',
            borderRadius: '4px',
            padding: '10px',
            flex: 1,
            overflow: 'auto'
          }}>
            {provider && (
              <TiptapEditorPlain
                key={reloadCount} // Force remount on reload
                isEditable={true}
                noteId={noteId}
                panelId={panelId}
                provider={provider}
                onUpdate={(content) => {
                  console.log('Editor updated')
                }}
                placeholder="Test content..."
              />
            )}
          </div>
        </div>
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h3>Debug Logs (Session: {sessionId})</h3>
          <div style={{ 
            background: '#1e1e1e',
            color: '#d4d4d4',
            padding: '10px',
            borderRadius: '4px',
            flex: 1,
            overflow: 'auto',
            fontSize: '11px',
            fontFamily: 'monospace'
          }}>
            {sessionLogs.length === 0 ? (
              <div style={{ color: '#666' }}>No logs for this session yet...</div>
            ) : (
              sessionLogs.map((log, i) => (
                <div 
                  key={i} 
                  style={{ 
                    marginBottom: '8px',
                    borderBottom: '1px solid #333',
                    paddingBottom: '8px'
                  }}
                >
                  <div style={{ color: '#4EC9B0' }}>
                    [{new Date(log.timestamp).toLocaleTimeString()}] {log.component} - {log.action}
                  </div>
                  {log.note_id && (
                    <div style={{ color: '#9CDCFE', marginLeft: '20px' }}>
                      Note: {log.note_id}, Panel: {log.panel_id}
                    </div>
                  )}
                  {log.content_preview && (
                    <div style={{ color: '#CE9178', marginLeft: '20px' }}>
                      Content: {log.content_preview}
                    </div>
                  )}
                  {log.metadata && (
                    <div style={{ color: '#B5CEA8', marginLeft: '20px' }}>
                      Metadata: {JSON.stringify(log.metadata, null, 2)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}