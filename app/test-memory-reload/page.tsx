'use client'

import { useEffect, useState } from 'react'

// Mock adapter that works in-memory
class MockAdapter {
  private storage = new Map<string, any>()
  
  async loadDocument(noteId: string, panelId: string) {
    const key = `${noteId}:${panelId}`
    console.log(`[MockAdapter] Loading document for ${key}`)
    const doc = this.storage.get(key)
    if (doc) {
      console.log(`[MockAdapter] Found document version ${doc.version}`)
      return doc
    }
    console.log(`[MockAdapter] No document found`)
    return null
  }
  
  async saveDocument(noteId: string, panelId: string, content: any, version: number, baseVersion: number) {
    const key = `${noteId}:${panelId}`
    console.log(`[MockAdapter] Saving document for ${key}, version ${version}`)
    this.storage.set(key, { content, version })
  }
  
  async createNote(input: any) { return { ...input, id: 'test-note-id' } }
  async updateNote(id: string, patch: any) { return { id, ...patch } }
  async getNote(id: string) { return null }
  async createBranch(input: any) { return { ...input, id: 'test-branch-id' } }
  async updateBranch(id: string, patch: any) { return { id, ...patch } }
  async listBranches(noteId: string) { return [] }
  async enqueueOffline(op: any) { }
  async flushQueue() { return { processed: 0, failed: 0 } }
}

// Simplified PlainOfflineProvider for testing
class TestProvider {
  private documents = new Map<string, any>()
  private documentVersions = new Map<string, number>()
  private adapter: MockAdapter
  
  constructor(adapter: MockAdapter) {
    this.adapter = adapter
    console.log('[TestProvider] Created new provider instance')
  }
  
  private getCacheKey(noteId: string, panelId: string): string {
    return `${noteId}-${panelId}`
  }
  
  async loadDocument(noteId: string, panelId: string) {
    const cacheKey = this.getCacheKey(noteId, panelId)
    console.log(`[TestProvider] loadDocument called for ${cacheKey}`)
    
    // Check cache first
    if (this.documents.has(cacheKey)) {
      console.log(`[TestProvider] Returning cached document`)
      return this.documents.get(cacheKey)
    }
    
    console.log(`[TestProvider] Cache miss, loading from adapter`)
    // Load from adapter
    const result = await this.adapter.loadDocument(noteId, panelId)
    if (result) {
      console.log(`[TestProvider] Caching loaded document`)
      this.documents.set(cacheKey, result.content)
      this.documentVersions.set(cacheKey, result.version)
      return result.content
    }
    
    return null
  }
  
  async saveDocument(noteId: string, panelId: string, content: any, skipPersist = false) {
    const cacheKey = this.getCacheKey(noteId, panelId)
    const previousVersion = this.documentVersions.get(cacheKey) || 0
    const nextVersion = previousVersion + 1
    
    console.log(`[TestProvider] saveDocument called for ${cacheKey}, version ${nextVersion}`)
    
    // Update cache
    this.documents.set(cacheKey, content)
    this.documentVersions.set(cacheKey, nextVersion)
    
    // Persist to adapter
    if (!skipPersist) {
      await this.adapter.saveDocument(noteId, panelId, content, nextVersion, previousVersion)
    }
  }
  
  getDocument(noteId: string, panelId: string) {
    const cacheKey = this.getCacheKey(noteId, panelId)
    const doc = this.documents.get(cacheKey) || null
    console.log(`[TestProvider] getDocument called for ${cacheKey}, found: ${!!doc}`)
    return doc
  }
  
  getDocumentVersion(noteId: string, panelId: string): number {
    const cacheKey = this.getCacheKey(noteId, panelId)
    const version = this.documentVersions.get(cacheKey) || 0
    console.log(`[TestProvider] getDocumentVersion called for ${cacheKey}, version: ${version}`)
    return version
  }
}

export default function TestMemoryReloadPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [testPhase, setTestPhase] = useState(0)
  
  const addLog = (message: string, highlight = false) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1)
    const entry = `[${timestamp}] ${message}`
    console.log(entry)
    setLogs(prev => [...prev, { text: entry, highlight }])
  }
  
  const runComprehensiveTest = async () => {
    setLogs([])
    setTestPhase(0)
    
    const noteId = 'test-note'
    const panelId = 'main'
    const pendingKey = `pending_save_${noteId}_${panelId}`
    
    addLog('=== COMPREHENSIVE DOUBLE RELOAD TEST ===', true)
    addLog('')
    
    // Setup: Create adapter that persists across reloads
    const adapter = new MockAdapter()
    
    // === INITIAL STATE ===
    addLog('INITIAL STATE: Setting up content', true)
    const provider1 = new TestProvider(adapter)
    
    const initialContent = { text: 'INITIAL content' }
    await provider1.saveDocument(noteId, panelId, initialContent)
    addLog('✓ Initial content saved to database')
    
    // Simulate old visibility change that creates localStorage backup
    const oldBackup = { text: 'OLD backup from previous visibility change' }
    localStorage.setItem(pendingKey, JSON.stringify({
      content: oldBackup,
      timestamp: Date.now() - 30000, // 30 seconds ago
      noteId,
      panelId
    }))
    addLog('✓ OLD backup saved to localStorage (simulating previous tab switch)')
    
    // User edits and saves NEW content
    const newContent = { text: 'NEW content after user edit' }
    await provider1.saveDocument(noteId, panelId, newContent)
    addLog('✓ NEW content saved to database (user edit completed)')
    addLog('')
    
    // === FIRST RELOAD ===
    addLog('FIRST RELOAD: Simulating page reload...', true)
    setTestPhase(1)
    
    // Create new provider (simulating page reload)
    const provider2 = new TestProvider(adapter)
    addLog('New provider created (cache is empty)')
    
    // Component loads document
    addLog('Component loading document...')
    const loaded1 = await provider2.loadDocument(noteId, panelId)
    addLog(`Loaded from database: "${loaded1?.text}"`)
    
    // Component checks localStorage
    addLog('Component checking localStorage...')
    const pendingData = localStorage.getItem(pendingKey)
    if (pendingData) {
      const parsed = JSON.parse(pendingData)
      addLog(`Found localStorage backup: "${parsed.content.text}"`)
      
      // Check provider state (what the component does)
      const existingDoc = provider2.getDocument(noteId, panelId)
      const existingVersion = provider2.getDocumentVersion(noteId, panelId)
      
      addLog(`Provider has content: ${!!existingDoc}, version: ${existingVersion}`)
      
      // The restore condition from the component
      if (!existingDoc && existingVersion === 0) {
        addLog('❌ RESTORING from localStorage (BAD - should not happen!)', true)
        await provider2.saveDocument(noteId, panelId, parsed.content)
        addLog(`Cache now contains: "${provider2.getDocument(noteId, panelId)?.text}"`)
      } else {
        addLog('✓ NOT restoring from localStorage (provider has content)')
        
        // But what if component still saves it?
        addLog('Testing: What if component saves localStorage content anyway?')
        await provider2.saveDocument(noteId, panelId, parsed.content)
        addLog(`⚠️ Cache OVERWRITTEN with: "${provider2.getDocument(noteId, panelId)?.text}"`, true)
      }
      
      // Simulate clearing localStorage after restore attempt
      localStorage.removeItem(pendingKey)
      addLog('localStorage cleared')
    }
    
    const finalContent1 = provider2.getDocument(noteId, panelId)
    addLog(`RESULT: User sees: "${finalContent1?.text}"`, true)
    addLog('')
    
    // === SECOND RELOAD ===
    addLog('SECOND RELOAD: Simulating another page reload...', true)
    setTestPhase(2)
    
    const provider3 = new TestProvider(adapter)
    addLog('New provider created (cache is empty again)')
    
    addLog('Component loading document...')
    const loaded2 = await provider3.loadDocument(noteId, panelId)
    addLog(`Loaded from database: "${loaded2?.text}"`)
    
    addLog('Component checking localStorage...')
    const pendingData2 = localStorage.getItem(pendingKey)
    if (pendingData2) {
      addLog('Found localStorage data (should not happen!)')
    } else {
      addLog('✓ No localStorage data (was cleared on first reload)')
    }
    
    const finalContent2 = provider3.getDocument(noteId, panelId)
    addLog(`RESULT: User sees: "${finalContent2?.text}"`, true)
    addLog('')
    
    // === ANALYSIS ===
    addLog('=== ANALYSIS ===', true)
    if (finalContent1?.text === oldBackup.text) {
      addLog('❌ BUG CONFIRMED: First reload showed OLD localStorage content!', true)
      addLog('Even though database had NEW content, localStorage was restored')
    } else if (finalContent1?.text === newContent.text) {
      addLog('✓ First reload showed correct NEW content')
    }
    
    if (finalContent2?.text === newContent.text || finalContent2?.text === oldBackup.text) {
      addLog(`Second reload showed: "${finalContent2?.text}"`)
    }
    
    addLog('')
    addLog('ROOT CAUSE:', true)
    addLog('The localStorage restore (line 234) calls saveDocument which')
    addLog('OVERWRITES the cache even when fresh content was just loaded!')
    addLog('This happens because restore logic saves to provider regardless')
    addLog('of whether the localStorage content is newer or older.')
  }
  
  const clearAll = () => {
    localStorage.clear()
    setLogs([])
    setTestPhase(0)
    addLog('✓ Cleared localStorage and logs')
  }
  
  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>In-Memory Double Reload Test</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={runComprehensiveTest}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Run Comprehensive Test
        </button>
        
        <button 
          onClick={clearAll}
          style={{
            padding: '10px 20px',
            background: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear All
        </button>
        
        <span style={{ marginLeft: '20px', color: '#666' }}>
          Phase: {testPhase === 0 ? 'Ready' : testPhase === 1 ? 'First Reload' : 'Second Reload'}
        </span>
      </div>
      
      <div style={{ 
        background: '#1e1e1e',
        color: '#d4d4d4',
        padding: '15px',
        borderRadius: '5px',
        height: '600px',
        overflowY: 'auto',
        fontSize: '13px',
        lineHeight: '1.6'
      }}>
        {logs.length === 0 ? (
          <div style={{ color: '#666' }}>Click "Run Comprehensive Test" to start...</div>
        ) : (
          logs.map((log, i) => (
            <div 
              key={i} 
              style={{ 
                marginBottom: '3px',
                color: log.highlight ? '#ffeb3b' :
                       log.text.includes('===') ? '#00bcd4' :
                       log.text.includes('✓') ? '#4caf50' :
                       log.text.includes('❌') ? '#f44336' :
                       log.text.includes('⚠️') ? '#ff9800' :
                       log.text.includes('Testing:') ? '#9c27b0' :
                       '#d4d4d4',
                fontWeight: log.highlight ? 'bold' : 'normal'
              }}
            >
              {log.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}