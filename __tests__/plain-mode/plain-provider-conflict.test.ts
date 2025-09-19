import { PlainOfflineProvider, PlainDocumentConflictError } from '@/lib/providers/plain-offline-provider'
import { TestAdapter } from '@/lib/adapters/test-adapter'
import type { ProseMirrorJSON } from '@/lib/providers/plain-offline-provider'

describe('PlainOfflineProvider conflict handling', () => {
  class ConflictTestAdapter extends TestAdapter {
    remoteVersion = 2
    remoteContent: ProseMirrorJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'remote-initial' }]
        }
      ]
    }

    async loadDocument(noteId: string, panelId: string) {
      return { content: this.remoteContent, version: this.remoteVersion }
    }

    async saveDocument(
      noteId: string,
      panelId: string,
      content: ProseMirrorJSON,
      version: number,
      baseVersion: number
    ): Promise<void> {
      this.remoteVersion += 1
      this.remoteContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `remote-updated-${this.remoteVersion}` }]
          }
        ]
      }
      throw new Error(`stale document save: baseVersion ${baseVersion} behind latest ${this.remoteVersion}`)
    }
  }

  it('reloads remote content and emits events when a conflict occurs', async () => {
    const adapter = new ConflictTestAdapter()
    const provider = new PlainOfflineProvider(adapter as any)
    const noteId = 'note-conflict'
    const panelId = 'panel-main'

    // Seed provider cache with remote document
    await provider.loadDocument(noteId, panelId)
    expect(provider.getDocument(noteId, panelId)).toEqual(adapter.remoteContent)
    expect(provider.getDocumentVersion(noteId, panelId)).toBe(adapter.remoteVersion)

    const conflictEvent = new Promise(resolve => {
      provider.once('document:conflict', resolve)
    })
    const remoteUpdateEvent = new Promise(resolve => {
      provider.once('document:remote-update', resolve)
    })

    const localContent: ProseMirrorJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'local-change' }]
        }
      ]
    }

    await expect(provider.saveDocument(noteId, panelId, localContent)).rejects.toBeInstanceOf(PlainDocumentConflictError)

    await conflictEvent
    const remotePayload: any = await remoteUpdateEvent

    expect(remotePayload.noteId).toBe(noteId)
    expect(remotePayload.panelId).toBe(panelId)
    expect(remotePayload.reason).toBe('conflict')
    expect(remotePayload.version).toBe(adapter.remoteVersion)
    expect(provider.getDocument(noteId, panelId)).toEqual(adapter.remoteContent)
    expect(provider.getDocumentVersion(noteId, panelId)).toBe(adapter.remoteVersion)
  })
})
