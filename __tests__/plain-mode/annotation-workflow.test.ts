/**
 * Tests for annotation workflow in plain mode
 * 
 * Verifies that the complete annotation workflow from docs/annotation_workflow.md
 * works properly in plain offline mode without Yjs.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { CanvasProvider } from '@/components/canvas/canvas-context'
import { AnnotationToolbar } from '@/components/canvas/annotation-toolbar'
import { TipTapEditorPlain } from '@/components/canvas/tiptap-editor-plain'
import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import { initializePlainProvider } from '@/lib/provider-switcher'
import type { PlainCrudAdapter } from '@/lib/providers/plain-offline-provider'

// Mock the environment to force plain mode
jest.mock('@/lib/provider-switcher', () => ({
  ...jest.requireActual('@/lib/provider-switcher'),
  getPlainProvider: jest.fn(),
  initializePlainProvider: jest.fn()
}))

// Mock window.electronAPI for Electron environment
global.window.electronAPI = undefined

// Mock adapter
class MockAdapter implements PlainCrudAdapter {
  private documents = new Map<string, any>()
  private branches = new Map<string, any>()
  
  async createNote(input: any) {
    const note = { id: 'note-1', ...input }
    return note
  }
  
  async updateNote(id: string, patch: any) {
    return { id, ...patch }
  }
  
  async getNote(id: string) {
    return { id, title: 'Test Note' }
  }
  
  async createBranch(input: any) {
    const branch = { 
      id: input.id || `branch-${Date.now()}`,
      ...input,
      created_at: new Date(),
      updated_at: new Date()
    }
    this.branches.set(branch.id, branch)
    return branch
  }
  
  async updateBranch(id: string, patch: any) {
    const branch = this.branches.get(id)
    if (!branch) throw new Error('Branch not found')
    Object.assign(branch, patch)
    return branch
  }
  
  async listBranches(noteId: string) {
    return Array.from(this.branches.values()).filter(b => b.noteId === noteId)
  }
  
  async saveDocument(noteId: string, panelId: string, content: any, version: number, baseVersion: number = version - 1) {
    const key = `${noteId}-${panelId}`
    this.documents.set(key, { content, version })
  }
  
  async loadDocument(noteId: string, panelId: string) {
    const key = `${noteId}-${panelId}`
    return this.documents.get(key) || null
  }
  
  async enqueueOffline(op: any) {
    // Mock queue
  }
  
  async flushQueue() {
    return { processed: 0, failed: 0 }
  }
}

describe('Annotation Workflow - Plain Mode', () => {
  let provider: PlainOfflineProvider
  let adapter: MockAdapter
  
  beforeEach(() => {
    // Set up plain mode
    process.env.NEXT_PUBLIC_COLLAB_MODE = 'plain'
    localStorage.setItem('collab-mode', 'plain')
    
    adapter = new MockAdapter()
    provider = new PlainOfflineProvider(adapter)
    
    // Mock getPlainProvider to return our provider
    const { getPlainProvider } = require('@/lib/provider-switcher')
    getPlainProvider.mockReturnValue(provider)
    
    // Initialize the provider
    initializePlainProvider(adapter)
  })
  
  afterEach(() => {
    provider.destroy()
    jest.clearAllMocks()
    localStorage.clear()
  })
  
  describe('1. Text Selection', () => {
    it('should highlight selected text and show annotation toolbar', async () => {
      const user = userEvent.setup()
      
      const TestComponent = () => {
        const editorRef = { current: null }
        return React.createElement(CanvasProvider, { noteId: 'test-note' },
          React.createElement('div', null,
            React.createElement(TipTapEditorPlain, {
              ref: editorRef,
              noteId: 'test-note',
              panelId: 'test-panel',
              content: 'Select this text to annotate',
              onSelectionChange: (text: string, range: any) => {
                if (text) {
                  // Show toolbar
                  const toolbar = document.getElementById('annotation-toolbar')
                  if (toolbar) {
                    toolbar.classList.add('visible')
                  }
                }
              }
            }),
            React.createElement(AnnotationToolbar)
          )
        )
      }
      
      render(React.createElement(TestComponent))
      
      // Wait for editor to load
      await waitFor(() => {
        expect(screen.getByText(/Select this text/)).toBeInTheDocument()
      })
      
      // Select text
      const textElement = screen.getByText(/Select this text/)
      await user.tripleClick(textElement) // Select all text
      
      // Toolbar should become visible
      await waitFor(() => {
        const toolbar = document.getElementById('annotation-toolbar')
        expect(toolbar).toHaveClass('visible')
      })
    })
  })
  
  describe('2. Annotation Menu', () => {
    it('should show three colored buttons (Note, Explore, Promote)', () => {
      render(
        React.createElement(CanvasProvider, { noteId: 'test-note' },
          React.createElement(AnnotationToolbar)
        )
      )
      
      const noteButton = screen.getByTitle('Create Note')
      const exploreButton = screen.getByTitle('Create Exploration')
      const promoteButton = screen.getByTitle('Create Promotion')
      
      expect(noteButton).toHaveTextContent('📝 Note')
      expect(exploreButton).toHaveTextContent('🔍 Explore')
      expect(promoteButton).toHaveTextContent('⭐ Promote')
      
      // Check colors
      expect(noteButton).toHaveStyle({ background: expect.stringContaining('#3498db') })
      expect(exploreButton).toHaveStyle({ background: expect.stringContaining('#f39c12') })
      expect(promoteButton).toHaveStyle({ background: expect.stringContaining('#27ae60') })
    })
  })
  
  describe('3. Annotation Type Selection', () => {
    it('should create annotation mark when type is selected', async () => {
      const mockInsertAnnotation = jest.fn()
      
      const TestComponent = () => {
        const editorRef = {
          current: {
            insertAnnotation: mockInsertAnnotation
          }
        }
        
        return React.createElement(CanvasProvider, { noteId: 'test-note' },
          React.createElement('div', {
            ref: (el: HTMLDivElement | null) => {
              if (el) {
                el.addEventListener('insert-annotation', (e: any) => {
                  mockInsertAnnotation(e.detail.type, e.detail.annotationId, e.detail.branchId)
                })
              }
            }
          },
            React.createElement(AnnotationToolbar)
          )
        )
      }
      
      const { container } = render(React.createElement(TestComponent))
      
      // Set up canvas context with selected text
      const { dispatch } = (window as any).__canvasContext = {
        state: { selectedText: 'Selected text', currentPanel: 'panel-1' },
        dispatch: jest.fn(),
        dataStore: new Map([['panel-1', { position: { x: 0, y: 0 } }]]),
        noteId: 'test-note'
      }
      
      // Click Note button
      const noteButton = screen.getByTitle('Create Note')
      fireEvent.click(noteButton)
      
      // Should dispatch events
      await waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith({
          type: 'SET_SELECTION',
          payload: { text: '', range: null, panel: null }
        })
      })
    })
  })
  
  describe('4. Branch Entry Auto-Creation', () => {
    it('should create branch entry with correct data', async () => {
      const { dispatch, dataStore } = (window as any).__canvasContext = {
        state: { selectedText: 'Important text', currentPanel: 'panel-1' },
        dispatch: jest.fn(),
        dataStore: new Map([['panel-1', { position: { x: 100, y: 100 }, branches: [] }]]),
        noteId: 'test-note'
      }
      
      render(
        React.createElement(CanvasProvider, { noteId: 'test-note' },
          React.createElement(AnnotationToolbar)
        )
      )
      
      // Click Explore button
      const exploreButton = screen.getByTitle('Create Exploration')
      fireEvent.click(exploreButton)
      
      // Wait for branch creation
      await waitFor(() => {
        const branches = adapter.listBranches('test-note')
        expect(branches).toHaveLength(1)
        expect(branches[0]).toMatchObject({
          type: 'explore',
          originalText: 'Important text',
          parentId: 'panel-1',
          noteId: 'test-note'
        })
      })
    })
  })
  
  describe('5. New Panel Creation', () => {
    it('should dispatch create-panel event with branch data', async () => {
      const createPanelHandler = jest.fn()
      window.addEventListener('create-panel', createPanelHandler)
      
      const { dispatch, dataStore } = (window as any).__canvasContext = {
        state: { selectedText: 'Text to promote', currentPanel: 'panel-1' },
        dispatch: jest.fn(),
        dataStore: new Map([['panel-1', { 
          position: { x: 200, y: 200 }, 
          branches: [] 
        }]]),
        noteId: 'test-note'
      }
      
      render(
        React.createElement(CanvasProvider, { noteId: 'test-note' },
          React.createElement(AnnotationToolbar)
        )
      )
      
      // Click Promote button
      const promoteButton = screen.getByTitle('Create Promotion')
      fireEvent.click(promoteButton)
      
      // Should dispatch create-panel event
      await waitFor(() => {
        expect(createPanelHandler).toHaveBeenCalled()
        const event = createPanelHandler.mock.calls[0][0]
        expect(event.detail.panelId).toMatch(/^branch-/)
      })
      
      window.removeEventListener('create-panel', createPanelHandler)
    })
  })
  
  describe('6. Panel Features', () => {
    it('should create panel with quoted reference content', async () => {
      const selectedText = 'This is the selected text for annotation'
      
      const { dataStore } = (window as any).__canvasContext = {
        state: { selectedText, currentPanel: 'panel-1' },
        dispatch: jest.fn(),
        dataStore: new Map([['panel-1', { 
          position: { x: 0, y: 0 }, 
          branches: [] 
        }]]),
        noteId: 'test-note'
      }
      
      render(
        React.createElement(CanvasProvider, { noteId: 'test-note' },
          React.createElement(AnnotationToolbar)
        )
      )
      
      // Click Note button
      const noteButton = screen.getByTitle('Create Note')
      fireEvent.click(noteButton)
      
      // Wait for branch creation
      await waitFor(async () => {
        const branches = await adapter.listBranches('test-note')
        expect(branches).toHaveLength(1)
        
        const branch = branches[0]
        // Check that content includes quoted reference
        expect(branch.content).toContain('<blockquote>')
        expect(branch.content).toContain(selectedText)
        expect(branch.content).toContain('Start writing your note here')
      })
    })
  })
  
  describe('7. Visual Connections', () => {
    it('should store connection data with annotation type color', async () => {
      const { dataStore } = (window as any).__canvasContext = {
        state: { selectedText: 'Connect this', currentPanel: 'panel-1' },
        dispatch: jest.fn(),
        dataStore: new Map([['panel-1', { 
          position: { x: 0, y: 0 }, 
          branches: [],
          type: 'main'
        }]]),
        noteId: 'test-note'
      }
      
      render(
        React.createElement(CanvasProvider, { noteId: 'test-note' },
          React.createElement(AnnotationToolbar)
        )
      )
      
      // Click Explore button
      const exploreButton = screen.getByTitle('Create Exploration')
      fireEvent.click(exploreButton)
      
      // Check that branch data includes type for connection coloring
      await waitFor(() => {
        const branches = adapter.listBranches('test-note')
        expect(branches[0].type).toBe('explore')
        expect(branches[0].metadata.annotationType).toBe('explore')
      })
    })
  })
  
  describe('8. Position Calculation', () => {
    it('should position new panels to the right of parent', async () => {
      const parentPosition = { x: 500, y: 300 }
      
      const { dataStore } = (window as any).__canvasContext = {
        state: { selectedText: 'Position test', currentPanel: 'panel-1' },
        dispatch: jest.fn(),
        dataStore: new Map([['panel-1', { 
          position: parentPosition,
          branches: []
        }]]),
        noteId: 'test-note'
      }
      
      render(
        React.createElement(CanvasProvider, { noteId: 'test-note' },
          React.createElement(AnnotationToolbar)
        )
      )
      
      // Click Note button
      const noteButton = screen.getByTitle('Create Note')
      fireEvent.click(noteButton)
      
      // Check position calculation
      await waitFor(() => {
        const entries = Array.from(dataStore.entries())
        const newPanel = entries.find(([key]) => key.startsWith('branch-'))
        
        expect(newPanel).toBeDefined()
        expect(newPanel![1].position.x).toBe(parentPosition.x + 900) // PANEL_SPACING_X
        expect(newPanel![1].position.y).toBe(parentPosition.y) // Same Y for first child
      })
    })
  })
})