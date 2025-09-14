Title: Space Bar Fix — Don’t Block Typing in Editors (Patch Preview)

Problem
- Pressing Space while typing in the note does nothing. Root cause is a global window keydown handler that intercepts Space and calls preventDefault() unconditionally.
- Where: `lib/hooks/use-layer-keyboard-shortcuts.ts` (handleKeyDown). It sets drag mode for Space and prevents default regardless of focus/target.

Fix Overview (safe)
- Only handle Space as a pan accelerator when focus is not inside an editable control.
- Add an `isEditableTarget()` helper and bail out for contentEditable, `.ProseMirror`, inputs/textareas/select, or elements with `[role="textbox"]`.
- Keep all other shortcuts unchanged.

Files
- lib/hooks/use-layer-keyboard-shortcuts.ts

Proposed Diff
```diff
diff --git a/lib/hooks/use-layer-keyboard-shortcuts.ts b/lib/hooks/use-layer-keyboard-shortcuts.ts
@@
 export const useLayerKeyboardShortcuts = (callbacks: ShortcutCallbacks) => {
@@
   const handleKeyDown = useCallback((event: KeyboardEvent) => {
     if (!multiLayerEnabled) return;
 
+    // Do not intercept Space when typing in editors or inputs
+    const isEditableTarget = (el: EventTarget | null): boolean => {
+      const t = el as HTMLElement | null;
+      if (!t) return false;
+      if (t.isContentEditable) return true;
+      const tag = t.tagName;
+      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
+      if (t.closest('[contenteditable], .ProseMirror, [role="textbox"], input, textarea, select')) return true;
+      return false;
+    };
+
     // Add key to pressed set
     keysPressed.current.add(event.code);
@@
     if (event.code === 'Space' && !isSpacePressed.current) {
-      isSpacePressed.current = true;
-      document.body.dataset.dragMode = 'active-layer';
-      callbacks.onSpaceDrag?.(true);
-      // Prevent page scroll
-      event.preventDefault();
+      if (isEditableTarget(event.target)) {
+        // Let editors/inputs receive Space normally
+        return;
+      }
+      isSpacePressed.current = true;
+      document.body.dataset.dragMode = 'active-layer';
+      callbacks.onSpaceDrag?.(true);
+      // Prevent page scroll only when we own the gesture
+      event.preventDefault();
     }
```

Why safe
- Limits scope to Space handling only and only when focus is outside editable contexts.
- No changes to Alt, Mod shortcuts, or layer switching.
- Doesn’t alter provider transforms or overlay logic.

Test Plan
- Focus a TipTap editor, type spaces → spaces appear; page does not pan.
- Click overlay empty space, hold Space + drag (if you keep the accelerator) → pans active layer; release Space → normal.
- Inputs and textareas elsewhere accept Space normally.

Rollback
- Revert the edits in `lib/hooks/use-layer-keyboard-shortcuts.ts` to restore previous behavior.

