# Plan: Widget Chat Wiring Helper (Reduce Manual Integration)

## Purpose
Make chat integration for widgets consistent and low‑effort by providing:
- a reusable **visibility/focus hook**, and
- a lightweight **manifest helper/template**.

This removes repeated boilerplate so custom widgets become chat‑aware by default.

---

## Current Pain Point
Every widget must manually wire:
- `registerVisiblePanel` / `unregisterVisiblePanel`
- `setFocusedPanelId`
- a full manifest definition
- chat output contract compliance

This is easy to forget and leads to widgets that are invisible to chat.

---

## Goals
- Reduce widget chat wiring to **one hook call + one manifest helper**.
- Ensure visibility/focus is always tracked.
- Enforce required manifest fields at compile time.

---

## Non‑Goals
- Auto‑register manifests from third‑party code without explicit opt‑in.
- Change the core panel registry contract.

---

## Proposed Solution

### 1) `usePanelChatVisibility(panelId, isActive)`
A small hook that standardizes visibility + focus:

**Behavior**
- On mount → `registerVisiblePanel(panelId)`
- On unmount → `unregisterVisiblePanel(panelId)`
- When `isActive` becomes true → `setFocusedPanelId(panelId)`

**File location**
- `lib/hooks/use-panel-chat-visibility.ts`

**Widget usage**
```ts
usePanelChatVisibility(chatPanelId, isActive)
```

---

### 2) `createPanelManifest(...)` helper
Factory functions that simplify manifest creation:

**File location**
- `lib/panels/create-manifest.ts`

**Exports**
- `createPanelManifest(input)` — create full manifest with defaults
- `createIntent(input)` — create intent with defaults (permission defaults to 'read')
- `createListIntent(panelId, title)` — template for standard list intent
- `createOpenItemIntent(panelId, title)` — template for standard open item intent

**Usage**
```ts
import { createPanelManifest, createIntent } from '@/lib/panels/create-manifest'

export const myWidgetManifest = createPanelManifest({
  panelId: 'my-widget',
  panelType: 'custom',
  title: 'My Widget',
  intents: [
    createIntent({
      name: 'show',
      description: 'Show my widget content',
      examples: ['show my widget', 'open my widget'],
      handler: 'api:/api/panels/my-widget/show',
      // permission defaults to 'read'
    }),
  ],
})

---

## Before/After Example

**Before (widget wiring)**
- ~15 lines of boilerplate per widget for register/unregister/focus

**After**
```ts
usePanelChatVisibility(chatPanelId, isActive)
```

---

## Implementation Steps
### Phase 1 (Now)
1) Create hook: `lib/hooks/use-panel-chat-visibility.ts`
2) Migrate built-in widgets:
   - `components/dashboard/widgets/RecentWidget.tsx`
   - `components/dashboard/widgets/QuickLinksWidget.tsx`
3) Update panel registry plan with a short checklist:
   - Call hook
   - Provide manifest
   - Return chat output contract

### Phase 2 (Complete)
- [x] `createPanelManifest(...)` factory function
- [x] `createIntent(...)` factory function
- [x] `createListIntent(...)` template helper
- [x] `createOpenItemIntent(...)` template helper
- [x] Widget author checklist documentation (in-file JSDoc)

---

## Acceptance Criteria
- [x] Hook compiles with no type errors
- [x] RecentWidget uses hook (removes ~15 lines of wiring)
- [x] QuickLinksWidget uses hook (removes ~15 lines of wiring)
- [x] "list my quick links" still uses lastQuickLinksBadge after reload
- [x] Type-check passes

**Phase 1 Completed:** 2025-01-02

---

## Success Criteria
- New widgets integrate with chat using 1 hook call.
- Visibility/focus wiring is consistent across widgets.

---

## Implementation Summary (Phase 1)

### Files Created
- `lib/hooks/use-panel-chat-visibility.ts` — reusable hook for widget chat integration

### Files Modified
- `components/dashboard/widgets/RecentWidget.tsx` — migrated to use hook (line 60)
- `components/dashboard/widgets/QuickLinksWidget.tsx` — migrated to use hook (line 108)

### Verification
- Type-check: Pass (no errors)
- Manual test: After selecting Quick Links E and reloading, "list my quick links" automatically uses Quick Links E without disambiguation

---

## Implementation Summary (Phase 2)

### Files Created
- `lib/panels/create-manifest.ts` — factory functions for manifest/intent creation

### Files Migrated
- `lib/panels/manifests/recent-panel.ts` — migrated to use `createPanelManifest`/`createIntent`
- `lib/panels/manifests/quick-links-panel.ts` — migrated to use `createPanelManifest`/`createIntent`

### Exports
| Function | Purpose |
|----------|---------|
| `createPanelManifest(input)` | Create full manifest with version default ('1.0') |
| `createIntent(input)` | Create intent with permission default ('read') |
| `createListIntent(panelId, title)` | Standard list intent template |
| `createOpenItemIntent(panelId, title)` | Standard open item intent template |

### Call Sites
- `lib/panels/manifests/recent-panel.ts:8`
- `lib/panels/manifests/quick-links-panel.ts:9`

### Verification
- Type-check: Pass (no errors)
- All built-in manifests migrated to use helpers

**Phase 2 Completed:** 2025-01-02

---

## Widget Author Checklist

To make a custom widget chat-aware:

1. **Create manifest** using `createPanelManifest()` + `createIntent()`
2. **Register manifest** in `lib/panels/panel-registry.ts`
3. **Wire visibility** with `usePanelChatVisibility(panelId, isActive)`
4. **Create API handler** at `app/api/panels/{panelId}/{intentName}/route.ts`

See `lib/panels/create-manifest.ts` for detailed JSDoc examples.
