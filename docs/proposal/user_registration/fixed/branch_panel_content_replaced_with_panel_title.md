# Branch panel content replaced with panel title

**Context**: plain mode branch hydration (Option A)
**Date**: 2025-09-21
**Owner**: Codex assistant session

## Summary
Branch panels reopened from the sidebar sometimes showed the annotation title (e.g., `"test 1 edited"`) instead of the saved panel content. Reloading the canvas made the problem deterministic: editing the branch, closing it, and reopening after a page refresh always reverted the panel to the annotated text. Tooltips continued to display the snippet because they read from the in-memory data store, but the editor content was being overwritten.

## Root Cause
`components/canvas/tiptap-editor-plain.tsx` marks `hasHydratedRef.current = true` too early:

1. When a pending snapshot exists in `localStorage`, the hook set `hasHydratedRef` before the editor applied that content.
2. When the provider returned remote content, `hasHydratedRef` was toggled immediately after `CONTENT_LOADED`, even though TipTap had not yet rendered the document.

TipTap fires an `onUpdate` with an empty `{ type: 'doc', content: [{ type: 'paragraph' }] }` payload during initialization. Because the hydration guard was already `true`, this first `onUpdate` saved the blank document (see `debug_logs` entries such as `EMPTY_CONTENT_SAVE` with `content_preview={
"type":"doc","content":[{"type":"paragraph"}]}`). Once the empty version reached Postgres, subsequent reloads treated the real document as missing and fell back to the preview string, logging `FALLBACK_DOC_RESTORED`/`FALLBACK_PREVIEW_DISPLAYED`.

## Solution
Delay hydration acknowledgement until the editor applies real content and ensure preview fallbacks never mark the editor as hydrated.

### Implementation
- Removed the premature `hasHydratedRef.current = true` assignments when pending snapshots or remote documents are detected.
- Reset preview bookkeeping but leave hydration false until TipTap finishes `setContent` with a non-empty payload.
- Inside the `APPLY_LOADED_CONTENT` effect, mark the editor hydrated only when the loaded content is **not** a preview fallback and `providerContentIsEmpty` returns `false`. If a preview fallback was used, explicitly keep hydration false.

### Key code
```tsx
// components/canvas/tiptap-editor-plain.tsx
// (excerpt around lines 497-1031)
if (notifyLoad) {
  onContentLoaded?.({ content: resolvedContent, version: remoteVersion })
  fallbackSourceRef.current = null
  previewFallbackContentRef.current = null
}
...
if (editor && loadedContent && !isContentLoading) {
  setTimeout(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(loadedContent, false)
      editor.view.updateState(editor.view.state)

      const treatedAsPreview = fallbackSourceRef.current === 'preview'
      const appliedIsEmpty = providerContentIsEmpty(provider, loadedContent)
      if (!treatedAsPreview && !appliedIsEmpty) {
        hasHydratedRef.current = true
      } else if (treatedAsPreview) {
        hasHydratedRef.current = false
      }
    }
  }, 0)
}
```

### Files affected
- `components/canvas/tiptap-editor-plain.tsx`

## Verification
1. Reloaded the note (`test-02`) and opened the problematic branch panel.
2. Observed that `debug_logs` no longer register `EMPTY_CONTENT_SAVE` entries for `branch-82f03e26-201e-4763-b74c-6e802a0ea39b` after mount.
3. Confirmed `document_saves` retains the edited panel body across reloads, and the UI displays the saved text instead of reverting to the annotation title.

## Follow-up
- Consider a small unit test or integration snapshot that ensures plain-mode hydration skips saving when the editor still holds an empty bootstrap document.
- Monitor for other early `hasHydratedRef` usages in the plain editor to avoid similar regressions when new fallback paths are added.
