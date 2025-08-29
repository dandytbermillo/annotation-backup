/**
 * Tests for preserving all 10 TipTap fixes in plain mode
 * 
 * Ensures that all critical fixes from the Yjs implementation
 * are properly preserved in the plain offline mode.
 */

import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import type { PlainCrudAdapter } from '@/lib/providers/plain-offline-provider'

// Mock adapter for testing
class MockPlainCrudAdapter implements PlainCrudAdapter {
  private storage = new Map<string, any>()
  
  async createNote(input: any) {
    const note = { id: Date.now().toString(), ...input, created_at: new Date(), updated_at: new Date() }
    this.storage.set(`note:${note.id}`, note)
    return note
  }
  
  async updateNote(id: string, patch: any) {
    const note = this.storage.get(`note:${id}`)
    if (!note) throw new Error('Note not found')
    Object.assign(note, patch, { updated_at: new Date() })
    return note
  }
  
  async getNote(id: string) {
    return this.storage.get(`note:${id}`) || null
  }
  
  async createBranch(input: any) {
    const branch = { id: Date.now().toString(), ...input, created_at: new Date(), updated_at: new Date() }
    this.storage.set(`branch:${branch.id}`, branch)
    return branch
  }
  
  async updateBranch(id: string, patch: any) {
    const branch = this.storage.get(`branch:${id}`)
    if (!branch) throw new Error('Branch not found')
    Object.assign(branch, patch, { updated_at: new Date() })
    return branch
  }
  
  async listBranches(noteId: string) {
    const branches = []
    for (const [key, value] of this.storage) {
      if (key.startsWith('branch:') && value.noteId === noteId) {
        branches.push(value)
      }
    }
    return branches
  }
  
  async saveDocument(noteId: string, panelId: string, content: any, version: number) {
    const key = `doc:${noteId}-${panelId}`
    this.storage.set(key, { content, version })
  }
  
  async loadDocument(noteId: string, panelId: string) {
    return this.storage.get(`doc:${noteId}-${panelId}`) || null
  }
  
  async enqueueOffline(op: any) {
    const key = `queue:${Date.now()}`
    this.storage.set(key, op)
  }
  
  async flushQueue() {
    let processed = 0
    for (const [key, value] of this.storage) {
      if (key.startsWith('queue:')) {
        this.storage.delete(key)
        processed++
      }
    }
    return { processed, failed: 0 }
  }
}

describe('10 TipTap Fixes Preservation in Plain Mode', () => {
  let provider: PlainOfflineProvider
  let adapter: MockPlainCrudAdapter
  
  beforeEach(() => {
    adapter = new MockPlainCrudAdapter()
    provider = new PlainOfflineProvider(adapter)
  })
  
  afterEach(() => {
    provider.destroy()
  })
  
  describe('Fix #1: Empty content guard', () => {
    it('should handle empty content properly', async () => {
      const noteId = 'test-note'
      const panelId = 'test-panel'
      
      // Test various empty content scenarios
      await provider.saveDocument(noteId, panelId, '<p></p>')
      const doc1 = await provider.loadDocument(noteId, panelId)
      expect(doc1).toEqual({ type: 'doc', content: [] })
      
      await provider.saveDocument(noteId, panelId, '')
      const doc2 = await provider.loadDocument(noteId, panelId)
      expect(doc2).toEqual({ type: 'doc', content: [] })
      
      await provider.saveDocument(noteId, panelId, { type: 'doc', content: [] })
      const doc3 = await provider.loadDocument(noteId, panelId)
      expect(doc3).toEqual({ type: 'doc', content: [] })
    })
  })
  
  describe('Fix #2 & #5: Composite cache keys', () => {
    it('should use composite noteId-panelId keys for caching', async () => {
      const noteId1 = 'note1'
      const noteId2 = 'note2'
      const panelId = 'panel1'
      
      const content1 = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note 1' }] }] }
      const content2 = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note 2' }] }] }
      
      await provider.saveDocument(noteId1, panelId, content1)
      await provider.saveDocument(noteId2, panelId, content2)
      
      const loaded1 = await provider.loadDocument(noteId1, panelId)
      const loaded2 = await provider.loadDocument(noteId2, panelId)
      
      expect(loaded1).toEqual(content1)
      expect(loaded2).toEqual(content2)
      expect(loaded1).not.toEqual(loaded2)
    })
  })
  
  describe('Fix #3: Async loading state tracking', () => {
    it('should prevent duplicate loading of same document', async () => {
      const noteId = 'test-note'
      const panelId = 'test-panel'
      
      // Save a document
      await provider.saveDocument(noteId, panelId, { type: 'doc', content: [] })
      
      // Simulate multiple simultaneous loads
      const loadPromises = [
        provider.loadDocument(noteId, panelId),
        provider.loadDocument(noteId, panelId),
        provider.loadDocument(noteId, panelId)
      ]
      
      const results = await Promise.all(loadPromises)
      
      // All should return the same result
      expect(results[0]).toEqual(results[1])
      expect(results[1]).toEqual(results[2])
    })
  })
  
  describe('Fix #4: No cache deletion on unmount', () => {
    it('should preserve cache on destroy', async () => {
      const noteId = 'test-note'
      const panelId = 'test-panel'
      const content = { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
      
      await provider.saveDocument(noteId, panelId, content, true)
      
      // Check document is cached
      const cached1 = provider.getDocument(noteId, panelId)
      expect(cached1).toEqual(content)
      
      // Destroy provider
      provider.destroy()
      
      // Document should still be in cache
      const cached2 = provider.getDocument(noteId, panelId)
      expect(cached2).toEqual(content)
    })
  })
  
  describe('Fix #6: Fragment field detection', () => {
    it('should detect field type from metadata', () => {
      const metadata1 = { fieldType: 'fragment' }
      const metadata2 = { fieldType: 'prosemirror' }
      const metadata3 = {}
      
      expect(provider.getFieldType(metadata1)).toBe('fragment')
      expect(provider.getFieldType(metadata2)).toBe('prosemirror')
      expect(provider.getFieldType(metadata3)).toBe('prosemirror')
    })
  })
  
  describe('Fix #7-9: Object state to avoid closures', () => {
    it('should use object state for persistence tracking', async () => {
      const state1 = provider.getPersistenceState()
      expect(state1.initialized).toBe(true)
      expect(state1.updateCount).toBe(0)
      
      // Perform some updates
      await provider.saveDocument('note1', 'panel1', { type: 'doc', content: [] })
      await provider.saveDocument('note2', 'panel2', { type: 'doc', content: [] })
      
      const state2 = provider.getPersistenceState()
      expect(state2.updateCount).toBeGreaterThan(0)
      expect(state2.lastSave).toBeGreaterThan(state1.lastSave)
    })
  })
  
  describe('Fix #10: Memoization to prevent loops', () => {
    it('should handle rapid updates without loops', async () => {
      const noteId = 'test-note'
      const panelId = 'test-panel'
      
      let updateCount = 0
      provider.on('document:saved', () => updateCount++)
      
      // Rapid updates
      for (let i = 0; i < 10; i++) {
        await provider.saveDocument(noteId, panelId, { 
          type: 'doc', 
          content: [{ type: 'text', text: `Update ${i}` }] 
        })
      }
      
      // Should have exact number of updates, no loops
      expect(updateCount).toBe(10)
    })
  })
  
  describe('Cache management and cleanup', () => {
    it('should clean up old cache entries when limit exceeded', async () => {
      // Create many documents to trigger cleanup
      for (let i = 0; i < 60; i++) {
        await provider.saveDocument(`note${i}`, `panel${i}`, { type: 'doc', content: [] }, true)
      }
      
      // Trigger additional saves to initiate cleanup
      for (let i = 0; i < 5; i++) {
        await provider.saveDocument(`cleanup${i}`, `panel${i}`, { type: 'doc', content: [] })
      }
      
      // Provider should have cleaned up some entries
      const state = provider.getPersistenceState()
      expect(state.updateCount).toBeLessThan(10) // Reset after cleanup
    })
  })
  
  describe('Offline queue integration', () => {
    it('should queue operations when persistence fails', async () => {
      // Create a failing adapter
      const failingAdapter = new MockPlainCrudAdapter()
      failingAdapter.saveDocument = jest.fn().mockRejectedValue(new Error('Network error'))
      
      const failingProvider = new PlainOfflineProvider(failingAdapter)
      
      await failingProvider.saveDocument('note1', 'panel1', { type: 'doc', content: [] })
      
      // Should have enqueued the operation
      const result = await failingAdapter.flushQueue()
      expect(result.processed).toBeGreaterThan(0)
      
      failingProvider.destroy()
    })
  })
})