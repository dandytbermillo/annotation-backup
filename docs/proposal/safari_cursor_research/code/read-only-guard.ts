import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * Read Only Guard Plugin
 * 
 * Allows cursor placement and selection but prevents modifications
 * when isEditable is false.
 */
export const ReadOnlyGuard = (isEditableRef: React.MutableRefObject<boolean>) => {
  let isInitialized = false
  
  return new Plugin({
    filterTransaction(tr, state) {
      // Always allow the first transaction (initial content load)
      if (!isInitialized) {
        isInitialized = true
        return true
      }
      
      // Allow all transactions in edit mode
      if (isEditableRef.current) {
        return true
      }
      
      // In read-only mode, only allow selection changes
      // Block any transaction that modifies the document
      if (tr.docChanged) {
        return false
      }
      
      // Allow selection changes (cursor movement)
      return true
    },
    
    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        // In read-only mode, prevent typing but allow navigation
        if (!isEditableRef.current) {
          // Allow arrow keys, page up/down, home/end for navigation
          const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 
                                  'PageUp', 'PageDown', 'Home', 'End']
          
          if (!navigationKeys.includes(event.key)) {
            // Prevent all other keys (typing, delete, etc.)
            event.preventDefault()
            return true
          }
        }
        return false
      },
      
      handleDOMEvents: {
        // Allow clicks for cursor placement even in read-only mode
        mousedown() {
          return false // Let the click through for cursor placement
        },
        
        // Prevent paste in read-only mode
        paste(view: EditorView, event: ClipboardEvent) {
          if (!isEditableRef.current) {
            event.preventDefault()
            return true
          }
          return false
        },
        
        // Prevent cut in read-only mode
        cut(view: EditorView, event: ClipboardEvent) {
          if (!isEditableRef.current) {
            event.preventDefault()
            return true
          }
          return false
        }
      }
    }
  })
}