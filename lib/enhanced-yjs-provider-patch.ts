// Enhanced YJS Provider Patch
// Adds the missing getProvider() method to make the enhanced provider compatible with existing components

import { EnhancedCollaborationProvider } from './enhanced-yjs-provider'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'

// Extend the prototype to add the missing method
declare module './enhanced-yjs-provider' {
  interface EnhancedCollaborationProvider {
    getProvider(): {
      awareness: Awareness;
      doc: Y.Doc;
      connect: () => void;
      disconnect: () => void;
      destroy: () => void;
      on: (event: string, handler: Function) => void;
      off: (event: string, handler: Function) => void;
    }
    getCurrentNoteId(): string | null;
    setCurrentNote(noteId: string): void;
  }
}

// Add the missing getProvider method
EnhancedCollaborationProvider.prototype.getProvider = function() {
  // Get or create awareness from presence map
  const presence = this.mainDoc.getMap('presence')
  let awareness = presence.get('awareness')
  
  if (!awareness || !(awareness instanceof Awareness)) {
    awareness = new Awareness(this.mainDoc)
    presence.set('awareness', awareness)
    
    // Initialize user state
    awareness.setLocalStateField('user', {
      name: 'User ' + Math.floor(Math.random() * 100),
      color: '#' + Math.floor(Math.random()*16777215).toString(16),
      id: Math.random().toString(36).substring(7)
    })
  }
  
  // Return provider interface compatible with TiptapEditor
  return {
    awareness,
    doc: this.mainDoc,
    connect: () => {
      console.log('Enhanced provider connected')
    },
    disconnect: () => {
      console.log('Enhanced provider disconnected')
    },
    destroy: () => {
      this.destroy()
    },
    on: (event: string, handler: Function) => {
      this.mainDoc.on(event as any, handler as any)
    },
    off: (event: string, handler: Function) => {
      this.mainDoc.off(event as any, handler as any)
    }
  }
}

// Add missing helper methods for compatibility
EnhancedCollaborationProvider.prototype.getCurrentNoteId = function() {
  return this.currentNoteId
}

EnhancedCollaborationProvider.prototype.setCurrentNote = function(noteId: string) {
  this.currentNoteId = noteId
  this.initializeNote(noteId, {})
}

// Export a helper to apply the patch
export function applyEnhancedProviderPatch() {
  console.log('Enhanced provider patch applied - getProvider() method added')
} 