'use client'

import { useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import { WebPostgresOfflineAdapter } from '@/lib/adapters/web-postgres-offline-adapter'

const TiptapEditorPlain = dynamic(
  () => import('@/components/canvas/tiptap-editor-plain'),
  { ssr: false }
)

export default function TestEditorReloadPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [provider] = useState(() => {
    const adapter = new WebPostgresOfflineAdapter()
    return new PlainOfflineProvider(adapter)
  })
  const [showEditor, setShowEditor] = useState(true)
  const [noteId] = useState(`test-note-${Date.now()}`)
  const panelId = 'main'
  const [reloadCount, setReloadCount] = useState(0)
  const editorRef = useRef<any>(null)
  
  const addLog = (message: string) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1)
    console.log(`[${timestamp}] ${message}`)
    setLogs(prev => [...prev, `[${timestamp}] ${message}`])
  }
  
  const simulateEdit = () => {
    addLog('Simulating user edit...')
    if (editorRef.current) {
      const content = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: `Edited at ${new Date().toISOString()}` }] }
        ]
      }
      // This would normally happen through user typing
      provider.saveDocument(noteId, panelId, content as any, false).then(() => {
        addLog('✓ Content saved to database')
        
        // Check cache
        const cached = provider.getDocument(noteId, panelId)
        const version = provider.getDocumentVersion(noteId, panelId)
        addLog(`Cache: v${version}, content: ${JSON.stringify(cached)}`)
      })
    }
  }
  
  const simulateVisibilityChange = () => {
    addLog('Simulating visibility change (tab switch)...')
    
    // This is what the editor does on visibility change
    const pendingKey = `pending_save_${noteId}_${panelId}`
    const backupContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'OLD content from visibility change' }] }
      ]
    }
    
    localStorage.setItem(pendingKey, JSON.stringify({
      content: backupContent,
      timestamp: Date.now(),
      noteId,
      panelId
    }))
    
    addLog('✓ localStorage backup created with OLD content')
  }
  
  const simulateReload = () => {
    addLog(`=== SIMULATING RELOAD #${reloadCount + 1} ===`)
    
    // Check what's in localStorage
    const pendingKey = `pending_save_${noteId}_${panelId}`
    const pendingData = localStorage.getItem(pendingKey)
    if (pendingData) {
      const parsed = JSON.parse(pendingData)
      addLog('localStorage has:', parsed.content?.content?.[0]?.content?.[0]?.text || 'unknown')
    } else {
      addLog('localStorage is empty')
    }
    
    // Unmount and remount editor (simulates reload)
    setShowEditor(false)
    setTimeout(() => {
      setShowEditor(true)
      setReloadCount(prev => prev + 1)
      addLog('Editor remounted (simulated reload complete)')
    }, 100)
  }
  
  const clearLocalStorage = () => {
    const pendingKey = `pending_save_${noteId}_${panelId}`
    localStorage.removeItem(pendingKey)
    addLog('✓ localStorage cleared')
  }
  
  const runFullScenario = async () => {
    setLogs([])
    addLog('=== FULL SCENARIO TEST ===')
    addLog(`Note ID: ${noteId}`)
    addLog('')
    
    addLog('1. Initial content save...')
    const initialContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Initial content' }] }
      ]
    }
    await provider.saveDocument(noteId, panelId, initialContent as any, false)
    addLog('✓ Initial content saved')
    addLog('')
    
    addLog('2. Simulating old visibility change (creates stale localStorage)...')
    simulateVisibilityChange()
    addLog('')
    
    addLog('3. User edits (new content to database)...')
    const newContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `NEW content - ${new Date().toISOString()}` }] }
      ]
    }
    await provider.saveDocument(noteId, panelId, newContent as any, false)
    addLog('✓ New content saved to database')
    addLog('')
    
    addLog('4. First reload (localStorage has OLD content)...')
    setTimeout(() => {
      simulateReload()
      
      setTimeout(() => {
        addLog('')
        addLog('5. Second reload (localStorage should be cleared)...')
        simulateReload()
      }, 2000)
    }, 1000)
  }
  
  return (
    <div style={{ padding: '20px' }}>
      <h1>Editor Reload Test - Realistic Scenario</h1>
      
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button onClick={runFullScenario} style={{ padding: '10px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px' }}>
          Run Full Scenario
        </button>
        <button onClick={simulateEdit} style={{ padding: '10px', background: '#2196F3', color: 'white', border: 'none', borderRadius: '4px' }}>
          Simulate Edit
        </button>
        <button onClick={simulateVisibilityChange} style={{ padding: '10px', background: '#FF9800', color: 'white', border: 'none', borderRadius: '4px' }}>
          Simulate Visibility Change
        </button>
        <button onClick={simulateReload} style={{ padding: '10px', background: '#9C27B0', color: 'white', border: 'none', borderRadius: '4px' }}>
          Simulate Reload
        </button>
        <button onClick={clearLocalStorage} style={{ padding: '10px', background: '#f44336', color: 'white', border: 'none', borderRadius: '4px' }}>
          Clear localStorage
        </button>
        <button onClick={() => setLogs([])} style={{ padding: '10px', background: '#666', color: 'white', border: 'none', borderRadius: '4px' }}>
          Clear Logs
        </button>
      </div>
      
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ flex: 1 }}>
          <h3>Editor (Reload count: {reloadCount})</h3>
          <div style={{ border: '2px solid #ccc', borderRadius: '4px', minHeight: '200px', padding: '10px' }}>
            {showEditor ? (
              <TiptapEditorPlain
                ref={editorRef}
                isEditable={true}
                noteId={noteId}
                panelId={panelId}
                provider={provider}
                onUpdate={(content) => {
                  addLog(`Editor update: ${JSON.stringify(content).substring(0, 100)}...`)
                }}
                placeholder="Test editor content..."
              />
            ) : (
              <div style={{ padding: '50px', textAlign: 'center', color: '#999' }}>
                Reloading...
              </div>
            )}
          </div>
        </div>
        
        <div style={{ flex: 1 }}>
          <h3>Logs</h3>
          <div style={{ 
            background: '#1e1e1e',
            color: '#00ff00',
            padding: '10px',
            borderRadius: '4px',
            height: '400px',
            overflowY: 'auto',
            fontSize: '11px',
            fontFamily: 'monospace'
          }}>
            {logs.map((log, i) => (
              <div key={i} style={{ 
                marginBottom: '2px',
                color: log.includes('===') ? '#00ffff' :
                       log.includes('✓') ? '#00ff00' :
                       log.includes('localStorage') ? '#ffaa00' :
                       '#aaa'
              }}>
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}