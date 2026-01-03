# Demo Widget Chat Integration Fix

**Date:** 2025-01-02
**Issue:** "show demo" command not recognized in chat
**Status:** Resolved

---

## Problem Statement

After implementing the Demo Widget with self-registration via `usePanelChatVisibility`, the chat command "show demo" returned:

> "The request does not match any supported intent"

The widget was visible on the dashboard, but the chat system couldn't recognize commands for it.

---

## Investigation

### Initial Hypothesis

The Demo Widget used the self-registration pattern:

```tsx
// DemoWidget.tsx
const manifest = useMemo(() => createDemoWidgetManifest(instanceId), [instanceId])
usePanelChatVisibility(panelId, isActive, { manifest })
```

This called `registerPanelManifests(manifests)` which should register the manifest with `panelRegistry`.

### Tracing the Architecture

1. **Chat Flow**: User types "show demo" → API `/api/chat/intent` → LLM parses intent
2. **LLM Prompt Building**: `buildIntentMessages()` → `panelRegistry.buildPromptSection()`
3. **Manifest Source**: `panelRegistry` singleton contains all registered manifests

### Root Cause Discovery

The `panelRegistry` is a **singleton** that exists separately on server and client:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ARCHITECTURE ISSUE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   CLIENT (Browser)                    SERVER (Next.js API)          │
│   ┌─────────────────────┐            ┌─────────────────────┐       │
│   │  panelRegistry      │            │  panelRegistry      │       │
│   │  (singleton)        │            │  (singleton)        │       │
│   ├─────────────────────┤            ├─────────────────────┤       │
│   │  - recent           │            │  - recent           │       │
│   │  - quick-links-*    │            │  - quick-links-*    │       │
│   │  - demo-widget ✅   │            │  - demo-widget ❌   │       │
│   │    (registered via  │            │    (NOT registered) │       │
│   │     useEffect)      │            │                     │       │
│   └─────────────────────┘            └─────────────────────┘       │
│                                                                     │
│   DemoWidget component               /api/chat/intent               │
│   registers manifest here            builds LLM prompt here         │
│   via usePanelChatVisibility         using server-side registry     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**The Problem:**
- `usePanelChatVisibility` runs on the **client** (in a React component)
- The chat intent API runs on the **server**
- Each has its own `panelRegistry` singleton instance
- Client-side registration doesn't affect server-side registry

**Why Built-in Panels Work:**
- `recentPanelManifest` and `quickLinksPanelManifests` are imported and registered in the `PanelIntentRegistry` constructor
- The constructor runs when the module is first loaded (on both server and client)
- Therefore, built-in panels are available on both sides

```typescript
// panel-registry.ts - constructor runs on module load
class PanelIntentRegistry {
  constructor() {
    this.registerBuiltIn()  // Runs on BOTH server and client
  }

  private registerBuiltIn() {
    this.register(recentPanelManifest)      // ✅ Available on server
    for (const manifest of quickLinksPanelManifests) {
      this.register(manifest)               // ✅ Available on server
    }
  }
}
```

---

## Solution Applied

### Fix: Static Manifest Registration

Created a static manifest file and registered it in the constructor alongside other built-in panels.

**1. Created `lib/panels/manifests/demo-widget-panel.ts`:**

```typescript
import { createPanelManifest, createIntent } from '../create-manifest'

export const demoWidgetManifest = createPanelManifest({
  panelId: 'demo-widget',
  panelType: 'custom',
  title: 'Demo Widget',
  intents: [
    createIntent({
      name: 'list_items',
      description: 'Show all items in the Demo Widget',
      examples: [
        'show demo',
        'show demo widget',
        'list demo items',
        'what is in demo',
        'open demo',
        'preview demo',
      ],
      handler: 'api:/api/panels/demo-widget/list',
      paramsSchema: {
        mode: {
          type: 'string',
          required: false,
          description: 'Display mode: "drawer" or "preview"',
          default: 'drawer',
        },
      },
    }),
  ],
})
```

**2. Updated `lib/panels/panel-registry.ts`:**

```typescript
// Import built-in manifests
import { recentPanelManifest } from './manifests/recent-panel'
import { quickLinksPanelManifests, createQuickLinksManifest } from './manifests/quick-links-panel'
import { demoWidgetManifest } from './manifests/demo-widget-panel'  // Added

private registerBuiltIn() {
  this.register(recentPanelManifest)
  for (const manifest of quickLinksPanelManifests) {
    this.register(manifest)
  }
  this.register(demoWidgetManifest)  // Added
}
```

**3. Simplified `components/dashboard/widgets/DemoWidget.tsx`:**

```typescript
// Static panel ID - must match the manifest in demo-widget-panel.ts
const DEMO_WIDGET_PANEL_ID = 'demo-widget'

export function DemoWidget({ panel, isActive, ... }) {
  // No manifest needed - it's registered statically
  usePanelChatVisibility(DEMO_WIDGET_PANEL_ID, isActive)
  // ...
}
```

---

## Result

After the fix, "show demo" works correctly:

```
User: "show demo"
Assistant: "Found 4 demo items"
         [Demo Widget preview with items]
         [> Show all 4 items]
```

---

## Key Takeaways

### For Built-in Widgets
1. Create manifest in `lib/panels/manifests/<widget>-panel.ts`
2. Import and register in `PanelIntentRegistry.registerBuiltIn()`
3. Widget component uses static panelId matching the manifest

### For True Third-Party Self-Registration (Future Enhancement)
The current architecture doesn't support runtime self-registration from third-party code because:
- Client-side registration doesn't affect server-side registry
- The LLM prompt is built on the server

**Potential Solutions:**
1. **Pass manifests with chat requests**: Include client-side manifests in the API request body
2. **Manifest API endpoint**: Third-party widgets call an API to register manifests server-side
3. **Manifest discovery**: Server scans for manifest files at startup

### Debug Logging Added
Added `debugLog` calls to trace registration:

```typescript
// lib/panels/register-panel.ts
debugLog({
  component: 'PanelRegistry',
  action: 'register_manifest',
  content_preview: `Registered panel ${manifest.panelId}: ${success}`,
  metadata: { panelId, panelType, intentCount, success }
})
```

Enable debug logging via:
- Environment: `NEXT_PUBLIC_DEBUG_LOGGING=true`
- localStorage: `annotation:debug-logging = true`

---

## Files Modified

| File | Change |
|------|--------|
| `lib/panels/manifests/demo-widget-panel.ts` | New - static manifest |
| `lib/panels/panel-registry.ts` | Import + register demo manifest |
| `components/dashboard/widgets/DemoWidget.tsx` | Use static panelId |
| `lib/hooks/use-panel-chat-visibility.ts` | Added debugLog |
| `lib/panels/register-panel.ts` | Added debugLog |

---

## Related Documents

- [Widget Chat Wiring Helper Plan](../widget-chat-wiring-helper-plan.md)
- [Panel Intent Registry Plan](../panel-intent-registry-plan.md)
