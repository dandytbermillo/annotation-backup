/**
 * Test suite to verify all 10 TipTap fixes work in plain mode
 */

import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import type { PlainCrudAdapter } from '@/lib/providers/plain-offline-provider'

// Mock adapter for testing
class MockAdapter implements PlainCrudAdapter {
  private storage = new Map<string, any>()
  
  async createNote(input: any) {
    const note = { id: Date.now().toString(), ...input, createdAt: new Date(), updatedAt: new Date() }
    this.storage.set(`note:${note.id}`, note)
    return note
  }
  
  async updateNote(id: string, patch: any) {
    const note = this.storage.get(`note:${id}`)
    if (!note) throw new Error('Note not found')
    const updated = { ...note, ...patch, updatedAt: new Date() }
    this.storage.set(`note:${id}`, updated)
    return updated
  }
  
  async getNote(id: string) {
    return this.storage.get(`note:${id}`) || null
  }
  
  async createBranch(input: any) {
    const branch = { id: Date.now().toString(), ...input, createdAt: new Date(), updatedAt: new Date() }
    this.storage.set(`branch:${branch.id}`, branch)
    return branch
  }
  
  async updateBranch(id: string, patch: any) {
    const branch = this.storage.get(`branch:${id}`)
    if (!branch) throw new Error('Branch not found')
    const updated = { ...branch, ...patch, updatedAt: new Date() }
    this.storage.set(`branch:${id}`, updated)
    return updated
  }
  
  async listBranches(noteId: string) {
    const branches: any[] = []
    this.storage.forEach((value, key) => {
      if (key.startsWith('branch:') && value.noteId === noteId) {
        branches.push(value)
      }
    })
    return branches
  }
  
  async saveDocument(noteId: string, panelId: string, content: any, version: number, baseVersion: number) {
    const key = `doc:${noteId}:${panelId}`
    const current = this.storage.get(key) as any

    if (typeof version !== 'number' || Number.isNaN(version)) {
      throw new Error('version must be a number')
    }

    if (typeof baseVersion !== 'number' || Number.isNaN(baseVersion)) {
      throw new Error('baseVersion must be a number')
    }

    const incomingSnapshot = typeof content === 'string' ? content : JSON.stringify(content)

    if (current) {
      const prevSnapshot = typeof current.content === 'string' ? current.content : JSON.stringify(current.content)

      if (prevSnapshot === incomingSnapshot && current.version === version) {
        return
      }

      if (current.version > baseVersion) {
        throw new Error(`stale document save: baseVersion ${baseVersion} behind latest ${current.version}`)
      }

      if (version <= current.version) {
        throw new Error(`non-incrementing version ${version} (latest ${current.version})`)
      }
    } else if (baseVersion !== 0) {
      throw new Error(`stale document save: baseVersion ${baseVersion} behind latest 0`)
    }

    if (version !== baseVersion + 1) {
      throw new Error(`non-sequential version ${version} (expected ${baseVersion + 1})`)
    }

    this.storage.set(key, { content, version })
  }
  
  async loadDocument(noteId: string, panelId: string) {
    const key = `doc:${noteId}:${panelId}`
    return this.storage.get(key) || null
  }
  
  async enqueueOffline(op: any) {
    const key = `queue:${Date.now()}`
    this.storage.set(key, op)
  }
  
  async flushQueue() {
    let processed = 0
    let failed = 0
    
    this.storage.forEach((value, key) => {
      if (key.startsWith('queue:')) {
        processed++
        this.storage.delete(key)
      }
    })
    
    return { processed, failed }
  }
}

describe('10 TipTap Fixes in Plain Mode', () => {
  let provider: PlainOfflineProvider
  let adapter: MockAdapter
  
  beforeEach(() => {
    adapter = new MockAdapter()
    provider = new PlainOfflineProvider(adapter)
  })
  
  afterEach(() => {
    provider.destroy()
  })
  
  test('Fix #1: No content duplication - empty content is cleared', async () => {
    // Save empty content variations
    await provider.saveDocument('note1', 'panel1', '<p></p>')
    await provider.saveDocument('note1', 'panel2', '')
    await provider.saveDocument('note1', 'panel3', { type: 'doc', content: [] })
    
    // Load and verify they're normalized
    const doc1 = await provider.loadDocument('note1', 'panel1')
    const doc2 = await provider.loadDocument('note1', 'panel2')
    const doc3 = await provider.loadDocument('note1', 'panel3')
    
    expect(doc1).toEqual({ type: 'doc', content: [] })
    expect(doc2).toEqual({ type: 'doc', content: [] })
    expect(doc3).toEqual({ type: 'doc', content: [] })
  })
  
  test('Fix #2: Note switching with composite keys', async () => {
    // Save content for different note-panel combinations
    await provider.saveDocument('note1', 'panel1', { type: 'doc', content: [{ type: 'text', text: 'Note 1' }] })
    await provider.saveDocument('note2', 'panel1', { type: 'doc', content: [{ type: 'text', text: 'Note 2' }] })
    
    // Load and verify isolation
    const doc1 = await provider.loadDocument('note1', 'panel1')
    const doc2 = await provider.loadDocument('note2', 'panel1')
    
    expect(doc1).not.toEqual(doc2)
    expect((doc1 as any).content[0].text).toBe('Note 1')
    expect((doc2 as any).content[0].text).toBe('Note 2')
  })
  
  test('Fix #3: Async loading with state tracking', async () => {
    const noteId = 'note1'
    const panelId = 'panel1'
    
    // Trigger multiple parallel loads
    const promise1 = provider.loadDocument(noteId, panelId)
    const promise2 = provider.loadDocument(noteId, panelId)
    const promise3 = provider.loadDocument(noteId, panelId)
    
    // All should return the same promise (deduplication)
    const results = await Promise.all([promise1, promise2, promise3])
    
    expect(results[0]).toBe(results[1])
    expect(results[1]).toBe(results[2])
  })
  
  test('Fix #4: No deletion on unmount - cache preserved', async () => {
    const noteId = 'note1'
    const panelId = 'panel1'
    const content = { type: 'doc', content: [{ type: 'text', text: 'Test' }] }
    
    // Save content
    await provider.saveDocument(noteId, panelId, content)
    
    // Destroy provider
    provider.destroy()
    
    // Create new provider and verify content still accessible from cache
    const newProvider = new PlainOfflineProvider(adapter)
    const cachedContent = newProvider.getDocument(noteId, panelId)
    
    expect(cachedContent).toEqual(content)
  })
  
  test('Fix #5: Composite key caching', async () => {
    // Test that same panel ID with different note IDs are isolated
    const panelId = 'shared-panel'
    
    await provider.saveDocument('note1', panelId, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note 1 content' }] }] })
    await provider.saveDocument('note2', panelId, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note 2 content' }] }] })
    await provider.saveDocument('note3', panelId, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note 3 content' }] }] })
    
    const doc1 = provider.getDocument('note1', panelId)
    const doc2 = provider.getDocument('note2', panelId)
    const doc3 = provider.getDocument('note3', panelId)
    
    expect(doc1).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note 1 content' }] }] })
    expect(doc2).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note 2 content' }] }] })
    expect(doc3).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note 3 content' }] }] })
  })
  
  test('Fix #6: Metadata handling for field type', () => {
    const metadata1 = { fieldType: 'prosemirror' }
    const metadata2 = { fieldType: 'default' }
    const metadata3 = {}
    
    expect(provider.getFieldType(metadata1)).toBe('prosemirror')
    expect(provider.getFieldType(metadata2)).toBe('default')
    expect(provider.getFieldType(metadata3)).toBe('prosemirror') // default
    expect(provider.getFieldType(null)).toBe('prosemirror') // default
  })
  
  test('Fix #7-9: Object-based state to avoid closures', async () => {
    const state = provider.getPersistenceState()
    
    expect(state).toHaveProperty('initialized', true)
    expect(state).toHaveProperty('lastSave')
    expect(state).toHaveProperty('updateCount')
    
    // Save a document and verify state updates
    const initialUpdateCount = state.updateCount
    await provider.saveDocument('note1', 'panel1', '<p>test</p>')
    
    const newState = provider.getPersistenceState()
    expect(newState.updateCount).toBe(initialUpdateCount + 1)
    expect(newState.lastSave).toBeGreaterThan(state.lastSave)
  })
  
  test('Fix #10: Prevent infinite load loops', async () => {
    const noteId = 'note1'
    const panelId = 'panel1'
    let loadCount = 0
    
    // Override adapter to count loads
    const originalLoad = adapter.loadDocument.bind(adapter)
    adapter.loadDocument = async (...args) => {
      loadCount++
      return originalLoad(...args)
    }
    
    // Trigger multiple loads in quick succession
    await Promise.all([
      provider.loadDocument(noteId, panelId),
      provider.loadDocument(noteId, panelId),
      provider.loadDocument(noteId, panelId),
      provider.loadDocument(noteId, panelId),
      provider.loadDocument(noteId, panelId)
    ])
    
    // Should only load once despite multiple requests
    expect(loadCount).toBe(1)
  })
  
  test('Smart cache cleanup', async () => {
    // Fill cache beyond limit
    for (let i = 0; i < 60; i++) {
      await provider.saveDocument(`note${i}`, `panel${i}`, { content: `Content ${i}` })
    }
    
    // Access some documents to mark them as recently used
    provider.getDocument('note55', 'panel55')
    provider.getDocument('note56', 'panel56')
    provider.getDocument('note57', 'panel57')
    
    // Trigger another save to force cleanup
    await provider.saveDocument('note60', 'panel60', '<p>Trigger cleanup</p>')
    
    // Recent documents should still be cached
    expect(provider.getDocument('note55', 'panel55')).toBeTruthy()
    expect(provider.getDocument('note56', 'panel56')).toBeTruthy()
    expect(provider.getDocument('note57', 'panel57')).toBeTruthy()
  })
  
  test('Offline queue functionality', async () => {
    // Enqueue some operations
    await provider.createBranch({
      noteId: 'note1',
      parentId: 'panel1',
      type: 'note',
      originalText: 'Test branch'
    })
    
    // Sync the queue
    const result = await provider.syncOfflineQueue()
    
    expect(result.processed).toBeGreaterThan(0)
    expect(result.failed).toBe(0)
  })
})