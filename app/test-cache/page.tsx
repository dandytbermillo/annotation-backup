'use client'

import { useEffect, useState } from 'react'
import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import { WebPostgresOfflineAdapter } from '@/lib/adapters/web-postgres-offline-adapter'

export default function TestCachePage() {
  const [logs, setLogs] = useState<string[]>([])
  
  const addLog = (message: string) => {
    console.log(message)
    setLogs(prev => [...prev, message])
  }

  useEffect(() => {
    async function runTest() {
      addLog('=== Testing Plain Mode Cache Behavior ===')
      
      const noteId = 'test-note-' + Date.now()
      const panelId = 'test-panel'
      
      // Create provider instance
      const adapter = new WebPostgresOfflineAdapter()
      const provider = new PlainOfflineProvider(adapter)
      
      addLog('\n--- Test 1: Initial Save and Load ---')
      
      // Save a document
      const content1 = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Original content at ' + new Date().toISOString() }] }
        ]
      }
      
      addLog('Saving document version 1...')
      await provider.saveDocument(noteId, panelId, content1 as any, false)
      
      // Load immediately (should use cache)
      addLog('Loading document (should use cache)...')
      const loaded1 = await provider.loadDocument(noteId, panelId)
      addLog('Loaded content: ' + JSON.stringify(loaded1))
      
      // Update the document
      const content2 = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'UPDATED content at ' + new Date().toISOString() }] }
        ]
      }
      
      addLog('\n--- Test 2: Update and Reload ---')
      addLog('Updating document to version 2...')
      await provider.saveDocument(noteId, panelId, content2 as any, false)
      
      // Load again (should get updated cache)
      addLog('Loading after update (from cache)...')
      const loaded2 = await provider.loadDocument(noteId, panelId)
      addLog('Loaded content: ' + JSON.stringify(loaded2))
      
      // Simulate what happens on page reload
      addLog('\n--- Test 3: Simulating Page Reload ---')
      addLog('Creating NEW provider instance (simulates page reload)...')
      const provider2 = new PlainOfflineProvider(adapter)
      
      addLog('Loading with new provider (empty cache, must fetch from DB)...')
      const loaded3 = await provider2.loadDocument(noteId, panelId)
      addLog('Result from new provider: ' + JSON.stringify(loaded3))
      
      // Check localStorage for pending saves
      addLog('\n--- Test 4: Check localStorage ---')
      const pendingKey = `pending_save_${noteId}_${panelId}`
      const pendingData = localStorage.getItem(pendingKey)
      if (pendingData) {
        addLog('⚠️ Found pending save in localStorage:')
        addLog(pendingData)
      } else {
        addLog('✓ No pending save in localStorage')
      }
      
      // Test the actual issue: save to localStorage manually
      addLog('\n--- Test 5: Simulate localStorage Backup Issue ---')
      localStorage.setItem(pendingKey, JSON.stringify({
        content: content1, // OLD content
        timestamp: Date.now(),
        noteId,
        panelId
      }))
      addLog('Manually saved OLD content to localStorage as backup')
      
      // Create another new provider and see what happens
      const provider3 = new PlainOfflineProvider(adapter)
      addLog('Created third provider instance...')
      
      // In the real app, the editor would check localStorage and potentially restore
      const backup = localStorage.getItem(pendingKey)
      if (backup) {
        const { content: backupContent } = JSON.parse(backup)
        addLog('Editor would see this backup: ' + JSON.stringify(backupContent))
      }
      
      // Load from provider
      const loaded4 = await provider3.loadDocument(noteId, panelId)
      addLog('Provider returns: ' + JSON.stringify(loaded4))
      
      addLog('\n=== CONCLUSION ===')
      addLog('1. Cache is NOT persistent across provider instances (page reloads)')
      addLog('2. Each reload creates a new provider with empty cache')
      addLog('3. localStorage backup mechanism may restore stale content')
      addLog('4. The issue is likely in the localStorage restore logic, NOT cache invalidation')
      
      // Clean up
      localStorage.removeItem(pendingKey)
    }
    
    runTest().catch(error => {
      addLog('ERROR: ' + error.message)
      console.error(error)
    })
  }, [])

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Plain Mode Cache Test</h1>
      <div style={{ whiteSpace: 'pre-wrap', background: '#f0f0f0', padding: '10px', borderRadius: '5px' }}>
        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
    </div>
  )
}