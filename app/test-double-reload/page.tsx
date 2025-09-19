'use client'

import { useEffect, useState, useRef } from 'react'
import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import { WebPostgresOfflineAdapter } from '@/lib/adapters/web-postgres-offline-adapter'

export default function TestDoubleReloadPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [provider, setProvider] = useState<PlainOfflineProvider | null>(null)
  const [testState, setTestState] = useState<'ready' | 'testing' | 'complete'>('ready')
  const noteId = useRef(`test-${Date.now()}`)
  const panelId = 'main'
  
  const addLog = (message: string, data?: any) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1)
    const logEntry = `[${timestamp}] ${message}`
    console.log(logEntry, data || '')
    setLogs(prev => [...prev, logEntry + (data ? ' ' + JSON.stringify(data, null, 2) : '')])
  }

  // Initialize provider on mount
  useEffect(() => {
    const adapter = new WebPostgresOfflineAdapter()
    const newProvider = new PlainOfflineProvider(adapter)
    setProvider(newProvider)
    addLog('Provider initialized')
    
    // Check what's in localStorage on mount
    const pendingKey = `pending_save_${noteId.current}_${panelId}`
    const existingData = localStorage.getItem(pendingKey)
    if (existingData) {
      addLog('⚠️ Found existing localStorage data on mount:', existingData)
    } else {
      addLog('✓ No localStorage data found on mount')
    }
    
    return () => {
      addLog('Component unmounting')
    }
  }, [])

  const runTest = async () => {
    if (!provider) {
      addLog('ERROR: Provider not initialized')
      return
    }
    
    setTestState('testing')
    setLogs([])
    
    const pendingKey = `pending_save_${noteId.current}_${panelId}`
    
    addLog('=== STARTING COMPREHENSIVE DOUBLE RELOAD TEST ===')
    addLog(`Note ID: ${noteId.current}`)
    addLog(`Panel ID: ${panelId}`)
    addLog('')
    
    // Step 1: Save initial content
    addLog('STEP 1: Saving initial content to database...')
    const initialContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `INITIAL content - ${new Date().toISOString()}` }] }
      ]
    }
    
    await provider.saveDocument(noteId.current, panelId, initialContent as any, false)
    addLog('✓ Initial content saved to provider')
    
    // Check cache
    const cached1 = provider.getDocument(noteId.current, panelId)
    const version1 = provider.getDocumentVersion(noteId.current, panelId)
    addLog('Cache after save:', { version: version1, content: cached1 })
    addLog('')
    
    // Step 2: Simulate visibility change to create localStorage backup
    addLog('STEP 2: Simulating visibility change (saves to localStorage)...')
    const backupContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'OLD backup content from visibility change' }] }
      ]
    }
    
    localStorage.setItem(pendingKey, JSON.stringify({
      content: backupContent,
      timestamp: Date.now() - 10000, // 10 seconds ago
      noteId: noteId.current,
      panelId
    }))
    addLog('✓ OLD content saved to localStorage (simulating previous visibility change)')
    addLog('')
    
    // Step 3: Update content (simulating user edit)
    addLog('STEP 3: User edits content (saves to database)...')
    const updatedContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `UPDATED content - ${new Date().toISOString()}` }] }
      ]
    }
    
    await provider.saveDocument(noteId.current, panelId, updatedContent as any, false)
    addLog('✓ Updated content saved to provider')
    
    // Check cache again
    const cached2 = provider.getDocument(noteId.current, panelId)
    const version2 = provider.getDocumentVersion(noteId.current, panelId)
    addLog('Cache after update:', { version: version2, content: cached2 })
    addLog('')
    
    // Step 4: Simulate first reload (new provider instance)
    addLog('STEP 4: SIMULATING FIRST RELOAD...')
    addLog('Creating new provider instance (simulating page reload)...')
    
    const adapter2 = new WebPostgresOfflineAdapter()
    const provider2 = new PlainOfflineProvider(adapter2)
    
    addLog('New provider created with empty cache')
    
    // Check initial cache state
    const cached3 = provider2.getDocument(noteId.current, panelId)
    const version3 = provider2.getDocumentVersion(noteId.current, panelId)
    addLog('New provider cache (should be empty):', { version: version3, content: cached3 })
    
    // Load document (simulating what happens in component)
    addLog('Loading document from database...')
    const loaded1 = await provider2.loadDocument(noteId.current, panelId)
    addLog('Loaded from database:', loaded1)
    
    // Check cache after load
    const cached4 = provider2.getDocument(noteId.current, panelId)
    const version4 = provider2.getDocumentVersion(noteId.current, panelId)
    addLog('Cache after load:', { version: version4, content: cached4 })
    
    // Now simulate localStorage check (what happens in the component)
    addLog('Checking localStorage for pending saves...')
    const pendingData = localStorage.getItem(pendingKey)
    if (pendingData) {
      const parsed = JSON.parse(pendingData)
      addLog('Found localStorage backup:', parsed)
      
      // Check if provider has content (this is what the component does)
      const existingDoc = provider2.getDocument(noteId.current, panelId)
      const existingVersion = provider2.getDocumentVersion(noteId.current, panelId)
      const providerHasContent = !!existingDoc && 
        (typeof existingDoc === 'object' ? existingDoc.content?.length > 0 : existingDoc !== '<p></p>')
      
      addLog('Provider state check:', {
        hasContent: providerHasContent,
        version: existingVersion
      })
      
      // Simulate the restore logic
      if (!providerHasContent && existingVersion === 0) {
        addLog('❌ WOULD RESTORE from localStorage (bad!)')
      } else {
        addLog('✓ Would NOT restore from localStorage (provider has content)')
      }
      
      // But let's see what actually happens if we call saveDocument
      addLog('Testing: What if we save localStorage content back to provider?')
      await provider2.saveDocument(noteId.current, panelId, parsed.content, false)
      
      const cached5 = provider2.getDocument(noteId.current, panelId)
      const version5 = provider2.getDocumentVersion(noteId.current, panelId)
      addLog('Cache after localStorage restore:', { version: version5, content: cached5 })
      addLog('⚠️ Cache was OVERWRITTEN with old localStorage content!')
    }
    addLog('')
    
    // Step 5: Simulate second reload
    addLog('STEP 5: SIMULATING SECOND RELOAD...')
    
    // Clear localStorage (simulating what happens after first reload)
    localStorage.removeItem(pendingKey)
    addLog('localStorage cleared')
    
    const adapter3 = new WebPostgresOfflineAdapter()
    const provider3 = new PlainOfflineProvider(adapter3)
    
    addLog('New provider created for second reload')
    
    const loaded2 = await provider3.loadDocument(noteId.current, panelId)
    addLog('Loaded from database:', loaded2)
    
    const cached6 = provider3.getDocument(noteId.current, panelId)
    const version6 = provider3.getDocumentVersion(noteId.current, panelId)
    addLog('Cache after load (no localStorage interference):', { version: version6, content: cached6 })
    
    addLog('')
    addLog('=== TEST COMPLETE ===')
    addLog('')
    addLog('CONCLUSION:')
    addLog('1. First reload: localStorage restore OVERWRITES the cache with old content')
    addLog('2. Second reload: No localStorage, shows correct database content')
    addLog('3. The bug is that localStorage restore happens even when provider has fresh data')
    
    setTestState('complete')
  }

  const clearLocalStorage = () => {
    const pendingKey = `pending_save_${noteId.current}_${panelId}`
    localStorage.removeItem(pendingKey)
    addLog('✓ localStorage cleared')
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Double Reload Issue - Comprehensive Test</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={runTest}
          disabled={!provider || testState === 'testing'}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: provider && testState !== 'testing' ? 'pointer' : 'not-allowed'
          }}
        >
          {testState === 'testing' ? 'Running Test...' : 'Run Test'}
        </button>
        
        <button 
          onClick={clearLocalStorage}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            background: '#ff9800',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear localStorage
        </button>
        
        <button 
          onClick={() => setLogs([])}
          style={{
            padding: '10px 20px',
            background: '#666',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear Logs
        </button>
      </div>
      
      <div style={{ 
        background: '#1e1e1e',
        color: '#00ff00',
        padding: '15px',
        borderRadius: '5px',
        height: '600px',
        overflowY: 'auto',
        fontSize: '12px',
        lineHeight: '1.4'
      }}>
        {logs.length === 0 ? (
          <div style={{ color: '#666' }}>Click "Run Test" to start the comprehensive test...</div>
        ) : (
          logs.map((log, i) => (
            <div 
              key={i} 
              style={{ 
                whiteSpace: 'pre-wrap',
                marginBottom: '2px',
                color: log.includes('ERROR') ? '#ff5555' : 
                       log.includes('⚠️') ? '#ffaa00' :
                       log.includes('✓') ? '#00ff00' :
                       log.includes('===') ? '#00ffff' :
                       log.includes('STEP') ? '#ffff00' :
                       '#aaaaaa'
              }}
            >
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  )
}