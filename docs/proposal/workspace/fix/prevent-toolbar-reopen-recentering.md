# Prevent Workspace Reopen Recentering — Implementation Plan

Goal: When a note panel is already visible on the canvas, clicking its workspace toolbar entry should only emit the highlight pulse. It must not recenter or move the panel unless we truly lack a persisted position.

---

## 1. Current Behavior Recap

- `handleNoteSelect` in `components/annotation-app.tsx` treats any note not found in `openNotes` as a “reopen”.
- With `NEXT_PUBLIC_CANVAS_CENTER_EXISTING_NOTES` left at its default (`enabled`), the reopen path invokes `computeVisuallyCenteredWorldPosition` and pushes that coordinate into `freshNoteSeeds`. This overrides the persisted position even if the panel is already on screen.
- Result: On first click after hydration (when `openNotes` hasn’t yet been populated for that id), panels snap to the center.

---

## 2. Target Behavior

1. If a persisted position exists (database, local cache, pending state), honor it. The panel stays where it was left.
2. Only compute a new centered coordinate when:
   - The note is brand new (toolbar create flow, no stored position), or
   - The persisted position is missing / offscreen fallback.
3. Keep manual “Center note” (crosshair button) behavior unchanged.
4. Maintain highlight emission, workspace persistence, and fresh-note seeding semantics.

---

## 3. Implementation Steps

1. **Guard the centering override**
   - Location: `handleNoteSelect` (`components/annotation-app.tsx`).
   - After resolving `persistedPosition = resolveMainPanelPosition(noteId)`, only allow the centering branch if `persistedPosition` is null or detected as the default offscreen value.
   - Suggested guard:
     ```ts
     const persistedPosition = resolveMainPanelPosition(noteId)
     const hasPersistedPosition = Boolean(persistedPosition && !isDefaultMainPosition(persistedPosition))

     if (!hasExplicitPosition && !alreadyOpen) {
       resolvedPosition = persistedPosition ?? null
     }

     const shouldCenterExisting =
       CENTER_EXISTING_NOTES_ENABLED &&
       !isToolbarCreation &&
       !hasExplicitPosition &&
       !hasPersistedPosition
     ```
     - `isDefaultMainPosition` already exists in canvas helpers; reuse it to detect the `{2000,1500}` fallback.
2. **Trim the fresh-seed write**
   - Only set `freshNoteSeeds[noteId]` when we are actually generating a new centered coordinate. If we’re using the persisted position, skip the assignment so the canvas doesn’t override it on first paint.
3. **Keep workspace persistence intact**
   - Even if we skip centering, `openWorkspaceNote` still needs to run the first time (hydrate + persistence). Ensure we pass the resolved persisted position into `mainPosition`.
4. **Optional environment override**
   - Document that setting `NEXT_PUBLIC_CANVAS_CENTER_EXISTING_NOTES=disabled` remains a fallback for forcing legacy behavior.

---

## 4. Testing Strategy

Manual:
- Load a workspace with at least one open note. Verify that the panel stays fixed when the page hydrates.
- Click the corresponding toolbar entry; observe only the highlight pulse, no jump.
- Close the note, click the toolbar entry to reopen: the note should recenter (since it was closed) if the flag is enabled.
- Use the crosshair button to confirm camera centering still works.

Automated:
- If practical, extend existing unit coverage (`__tests__/canvas/handle-note-select.test.ts`) to assert the new guard behavior (e.g., `resolveMainPanelPosition` returning a defined coordinate prevents fresh seeds).

---

## 5. Rollout Checklist

- ✅ Update `handleNoteSelect` logic with guard.
- ✅ Verify manual testing across: existing note reopen, brand-new note, explicit center action.
- ✅ Consider adding a short blurb to developer docs explaining the flag behavior.
- 🔄 Optional: add regression test if the canvas test harness is easy to extend.
