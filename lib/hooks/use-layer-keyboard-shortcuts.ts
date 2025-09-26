import { useEffect, useCallback, useRef } from 'react';
import { useFeatureFlag } from '@/lib/offline/feature-flags';

interface ShortcutCallbacks {
  toggleLayer?: () => void;
  switchToNotes?: () => void;
  switchToPopups?: () => void;
  toggleSidebar?: () => void;
  resetView?: () => void;
  onAltDrag?: (isDragging: boolean) => void;
  onSpaceDrag?: (isDragging: boolean) => void;
}

/**
 * Cross-platform key detection
 */
const getPlatformModifier = (): string => {
  if (typeof navigator === 'undefined') return 'Control';
  
  const platform = navigator.platform?.toLowerCase() || '';
  const userAgent = navigator.userAgent?.toLowerCase() || '';
  
  if (platform.includes('mac') || userAgent.includes('mac')) {
    return 'Meta'; // Cmd on Mac
  }
  return 'Control'; // Ctrl on Windows/Linux
};

/**
 * Hook for handling layer keyboard shortcuts
 * Provides cross-platform keyboard navigation for the multi-layer canvas
 */
export const useLayerKeyboardShortcuts = (callbacks: ShortcutCallbacks) => {
  const multiLayerFlag = useFeatureFlag('ui.multiLayerCanvas');
  const layerModelEnabled = useFeatureFlag('ui.layerModel');
  const multiLayerEnabled = multiLayerFlag && layerModelEnabled;
  const modifierKey = getPlatformModifier();
  const keysPressed = useRef(new Set<string>());
  
  // Track key states
  const isAltPressed = useRef(false);
  const isSpacePressed = useRef(false);
  
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!multiLayerEnabled) return;
    
    // Do not intercept Space when typing in editors or inputs
    const isEditableTarget = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      if (t.isContentEditable) return true;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (t.closest('[contenteditable], .ProseMirror, [role="textbox"], input, textarea, select')) return true;
      return false;
    };

    // Add key to pressed set
    keysPressed.current.add(event.code);
    
    // Track modifier keys for drag behavior
    if (event.altKey && !isAltPressed.current) {
      isAltPressed.current = true;
      document.body.dataset.dragMode = 'popup-only';
      callbacks.onAltDrag?.(true);
    }
    
    if (event.code === 'Space' && !isSpacePressed.current) {
      // Let editors/inputs receive Space normally
      if (isEditableTarget(event.target)) {
        return;
      }
      isSpacePressed.current = true;
      document.body.dataset.dragMode = 'active-layer';
      callbacks.onSpaceDrag?.(true);
      // Prevent page scroll only when we own the gesture
      event.preventDefault();
    }
    
    // Tab - Toggle between layers
    if (event.code === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      callbacks.toggleLayer?.();
      return;
    }
    
    // Escape - Focus notes canvas
    if (event.code === 'Escape') {
      callbacks.switchToNotes?.();
      return;
    }
    
    // Mod+1 - Focus notes layer
    if ((event.metaKey || event.ctrlKey) && event.code === 'Digit1') {
      event.preventDefault();
      callbacks.switchToNotes?.();
      return;
    }
    
    // Mod+2 - Focus popups layer
    if ((event.metaKey || event.ctrlKey) && event.code === 'Digit2') {
      event.preventDefault();
      callbacks.switchToPopups?.();
      return;
    }
    
    // Mod+B - Toggle sidebar
    if ((event.metaKey || event.ctrlKey) && event.code === 'KeyB') {
      event.preventDefault();
      callbacks.toggleSidebar?.();
      return;
    }
    
    // Mod+0 - Reset view
    if ((event.metaKey || event.ctrlKey) && event.code === 'Digit0') {
      event.preventDefault();
      callbacks.resetView?.();
      return;
    }
  }, [multiLayerEnabled, callbacks]);
  
  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (!multiLayerEnabled) return;
    
    // Remove key from pressed set
    keysPressed.current.delete(event.code);
    
    // Track modifier key release
    if (!event.altKey && isAltPressed.current) {
      isAltPressed.current = false;
      delete document.body.dataset.dragMode;
      callbacks.onAltDrag?.(false);
    }
    
    if (event.code === 'Space' && isSpacePressed.current) {
      isSpacePressed.current = false;
      delete document.body.dataset.dragMode;
      callbacks.onSpaceDrag?.(false);
    }
  }, [multiLayerEnabled, callbacks]);
  
  // Setup event listeners
  useEffect(() => {
    if (!multiLayerEnabled) return;
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Cleanup on unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      
      // Clear any active states
      isAltPressed.current = false;
      isSpacePressed.current = false;
      delete document.body.dataset.dragMode;
      keysPressed.current.clear();
    };
  }, [multiLayerEnabled, handleKeyDown, handleKeyUp]);
  
  // Return current modifier states for UI display
  return {
    isAltPressed: isAltPressed.current,
    isSpacePressed: isSpacePressed.current,
    modifierKey,
  };
};

/**
 * Get display-friendly shortcut labels
 */
export const getShortcutDisplay = () => {
  const isMac = getPlatformModifier() === 'Meta';
  const mod = isMac ? '⌘' : 'Ctrl';
  
  return {
    'Tab': 'Toggle between layers',
    'Escape': 'Focus notes canvas',
    [`${mod}+1`]: 'Focus notes layer',
    [`${mod}+2`]: 'Focus popups layer',
    [`${mod}+B`]: 'Toggle sidebar',
    'Alt+Drag': 'Pan only popup layer',
    'Space+Drag': 'Pan active layer',
    [`${mod}+0`]: 'Reset view',
  };
};

/**
 * Check if a keyboard event matches a specific shortcut
 */
export const matchesShortcut = (
  event: KeyboardEvent,
  shortcut: string
): boolean => {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  
  // Check modifiers
  const needsCtrl = parts.includes('ctrl') || parts.includes('control');
  const needsMeta = parts.includes('cmd') || parts.includes('meta') || parts.includes('⌘');
  const needsAlt = parts.includes('alt') || parts.includes('option');
  const needsShift = parts.includes('shift');
  const needsMod = parts.includes('mod'); // Platform-specific modifier
  
  // Platform-specific mod key
  const modPressed = getPlatformModifier() === 'Meta' ? event.metaKey : event.ctrlKey;
  
  // Check if all required modifiers are pressed
  if (needsMod && !modPressed) return false;
  if (needsCtrl && !event.ctrlKey) return false;
  if (needsMeta && !event.metaKey) return false;
  if (needsAlt && !event.altKey) return false;
  if (needsShift && !event.shiftKey) return false;
  
  // Check the main key
  const eventKey = event.key.toLowerCase();
  const eventCode = event.code.toLowerCase();
  
  // Handle special keys
  if (key === 'tab' && eventCode === 'tab') return true;
  if (key === 'escape' && eventCode === 'escape') return true;
  if (key === 'space' && eventCode === 'space') return true;
  
  // Handle digit keys
  if (key.match(/^\d$/) && eventCode === `digit${key}`) return true;
  
  // Handle letter keys
  if (key.match(/^[a-z]$/) && eventCode === `key${key}`) return true;
  
  // Direct key match
  return eventKey === key;
};
