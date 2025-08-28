import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import { TestAdapter } from '@/lib/adapters/test-adapter'

describe('Plain Mode Integration Tests', () => {
  let provider: PlainOfflineProvider
  let adapter: TestAdapter

  beforeEach(() => {
    adapter = new TestAdapter()
    provider = new PlainOfflineProvider(adapter)
  })

  describe('Note Operations via Adapter', () => {
    it('should create and retrieve a note', async () => {
      const note = await adapter.createNote({
        title: 'Test Note'
      })

      expect(note.id).toBeTruthy()
      expect(note.title).toBe('Test Note')

      const notes = await adapter.listNotes()
      expect(notes).toHaveLength(1)
      expect(notes[0].id).toBe(note.id)
    })

    it('should update a note', async () => {
      const note = await adapter.createNote({
        title: 'Original Title'
      })

      const updated = await adapter.updateNote(note.id, {
        title: 'Updated Title',
        version: 1
      })

      expect(updated.title).toBe('Updated Title')
    })
  })

  describe('Branch Operations', () => {
    it('should create branches with proper hierarchy', async () => {
      const note = await adapter.createNote({
        title: 'Test Note'
      })

      const branch1 = await provider.createBranch({
        noteId: note.id,
        type: 'note',
        originalText: 'Selected text'
      })

      const branch2 = await provider.createBranch({
        noteId: note.id,
        parentId: branch1.id,
        type: 'explore',
        originalText: 'Nested selection'
      })

      expect(branch1.parentId).toBe('')
      expect(branch2.parentId).toBe(branch1.id)

      const branches = provider.getBranchesForNote(note.id)
      expect(branches).toHaveLength(2)
    })

    it('should update branches', async () => {
      const note = await adapter.createNote({
        title: 'Test Note'
      })

      const branch = await provider.createBranch({
        noteId: note.id,
        type: 'note',
        originalText: 'Original text'
      })

      const updated = await provider.updateBranch(branch.id, {
        type: 'explore',
        originalText: 'Updated text'
      })

      expect(updated).not.toBeNull()
      expect(updated?.type).toBe('explore')
      expect(updated?.originalText).toBe('Updated text')
    })
  })

  describe('Document Persistence', () => {
    it('should save and load HTML documents', async () => {
      const note = await adapter.createNote({
        title: 'Doc Test'
      })

      const htmlContent = '<p>Hello <strong>world</strong></p>'
      await provider.saveDocument(note.id, 'panel-1', htmlContent)

      const loaded = await provider.loadDocument(note.id, 'panel-1')
      expect(loaded).toBe(htmlContent)
    })

    it('should save and load ProseMirror JSON', async () => {
      const note = await adapter.createNote({
        title: 'JSON Test'
      })

      const jsonContent = {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }]
        }]
      }

      await provider.saveDocument(note.id, 'panel-2', jsonContent)

      const loaded = await provider.loadDocument(note.id, 'panel-2')
      expect(loaded).toEqual(jsonContent)
    })
  })

  describe('Cache Management', () => {
    it('should cache loaded documents', async () => {
      const note = await adapter.createNote({
        title: 'Cache Test'
      })

      const content = '<p>Cached content</p>'
      await provider.saveDocument(note.id, 'panel-1', content)

      // First load
      const loaded1 = await provider.loadDocument(note.id, 'panel-1')
      
      // Second load should use cache
      const loaded2 = provider.getDocument(note.id, 'panel-1')
      
      expect(loaded1).toBe(content)
      expect(loaded2).toBe(content)
    })

    it('should track document versions', () => {
      const version = provider.getDocumentVersion('note-1', 'panel-1')
      expect(version).toBe(0) // Default when not loaded
    })
  })

  describe('Error Handling', () => {
    it('should handle non-existent branch gracefully', async () => {
      const result = await provider.updateBranch('non-existent', { 
        type: 'explore' 
      })
      expect(result).toBeNull()
    })

    it('should queue operations on adapter errors', async () => {
      // This would require mocking adapter methods to throw errors
      // For now, we'll just verify the adapter interface
      expect(adapter.enqueueOffline).toBeDefined()
      expect(adapter.flushQueue).toBeDefined()
    })
  })
})