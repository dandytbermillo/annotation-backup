# DB Manifest Visibility Filter Fix

**Date:** 2025-01-04
**Issue:** Custom widgets installed via Widget Manager not recognized by chat
**Status:** Resolved
**Related:** [2025-01-02-demo-widget-chat-integration-fix.md](./2025-01-02-demo-widget-chat-integration-fix.md)

---

## Background

Following the Widget Manager implementation (Phases 1-3), the Demo Widget was migrated from a **built-in widget** to an **installable custom widget**. This involved:

1. Removing Demo Widget from `panel-registry.ts` constructor
2. Moving manifest to `custom_widgets/demo_widget/manifest.json`
3. Installing via Widget Manager's "From File" feature
4. Storing manifest in `installed_widgets` DB table

---

## Problem Statement

After installing the Demo Widget via Widget Manager's "From File" feature:

1. Widget appeared correctly in Widget Manager drawer (enabled, with chat commands listed)
2. Database confirmed installation (`enabled = true`, manifest stored correctly)
3. But chat returned: **"The request does not match any supported intent"**

Debug logs added to `intent-prompt.ts` confirmed DB manifests were loading:

```
[buildIntentMessages] Loading DB manifests for userId: 00000000-0000-0000-0000-000000000000
[buildIntentMessages] Got DB manifests: 1 [ 'demo-widget' ]
[buildIntentMessages] Panel intents section length: 2922
```

Yet the LLM didn't recognize "show demo" commands.

---

## Investigation

### Tracing the Code Path

```
User types "show demo"
    ↓
/api/chat/navigate calls buildIntentMessages(msg, context, userId)
    ↓
buildIntentMessages() loads DB manifests via getEnabledManifests(userId)
    ↓
panelRegistry.buildPromptSectionWithDBManifests(dbManifests, visiblePanelIds, focusedPanelId)
    ↓
registerDBManifests(manifests) → adds to this.manifests Map
    ↓
buildPromptSection() → getVisibleIntents(visiblePanelIds)
    ↓
HERE'S THE PROBLEM ⚠️
```

### Root Cause: Visibility Filter

In `panel-registry.ts`, the `getVisibleIntents()` method:

```typescript
getVisibleIntents(visiblePanelIds?: string[]) {
  const panelFilter = visiblePanelIds ? new Set(visiblePanelIds) : null

  for (const manifest of this.manifests.values()) {
    // THIS FILTERED OUT DB MANIFESTS!
    if (panelFilter && !panelFilter.has(manifest.panelId)) {
      continue  // ← Demo widget skipped here
    }
    // ... add to results
  }
}
```

The `visiblePanelIds` parameter comes from the chat context - it contains **physical dashboard panels** currently visible to the user (e.g., `['recent', 'quick-links-a']`).

**The Problem:**
- Custom widgets installed via Widget Manager don't have physical dashboard panels
- They are chat-only or sandbox-based
- They were never in `visiblePanelIds`
- Therefore they were filtered out of the LLM prompt

```
┌─────────────────────────────────────────────────────────────────────┐
│                      VISIBILITY FILTER ISSUE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   visiblePanelIds from client:      Registered manifests:          │
│   ┌─────────────────────┐           ┌─────────────────────┐        │
│   │ • recent            │           │ • recent      ✅    │        │
│   │ • quick-links-a     │           │ • quick-links-a ✅  │        │
│   │ • quick-links-b     │           │ • quick-links-b ✅  │        │
│   └─────────────────────┘           │ • demo-widget  ❌   │        │
│                                     │   (DB manifest,     │        │
│   Filter: panelFilter.has(panelId)  │    not in filter)   │        │
│                                     └─────────────────────┘        │
│                                                                     │
│   Result: demo-widget EXCLUDED from LLM prompt!                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Solution

### Fix: Bypass Visibility Filter for DB Manifests

Modified `getVisibleIntents()` to never filter out DB-loaded manifests:

```typescript
// lib/panels/panel-registry.ts

getVisibleIntents(visiblePanelIds?: string[]) {
  const panelFilter = visiblePanelIds ? new Set(visiblePanelIds) : null

  for (const manifest of this.manifests.values()) {
    // IMPORTANT: Always include DB-loaded manifests (custom widgets)
    // They don't have physical panels on dashboard but should be available in chat
    const isDBManifest = this.dbManifestIds.has(manifest.panelId)

    // Filter by visibility if provided, but never filter out DB manifests
    if (panelFilter && !panelFilter.has(manifest.panelId) && !isDBManifest) {
      continue
    }

    for (const intent of manifest.intents) {
      result.push({ manifest, intent })
    }
  }
}
```

**Key Change:**
```typescript
// Before
if (panelFilter && !panelFilter.has(manifest.panelId)) { continue }

// After
if (panelFilter && !panelFilter.has(manifest.panelId) && !isDBManifest) { continue }
```

---

## Safety Analysis

Before applying this fix, verified all security layers remain intact:

| Security Layer | Location | Protection | Status |
|----------------|----------|------------|--------|
| **User Isolation** | widget-store.ts:127 | `WHERE (user_id = $1 OR user_id IS NULL)` | ✅ Safe |
| **Enabled-Only** | widget-store.ts:243 | `{ enabledOnly: true }` | ✅ Safe |
| **Manifest Validation** | panel-manifest.ts:189-229 | Required fields, structure | ✅ Safe |
| **API-Only Handlers** | panel-manifest.ts:214-217 | `handler.startsWith('api:')` | ✅ Safe |
| **Write Permission Gating** | intent-resolver.ts:1712-1718 | Confirmation required | ✅ Safe |

### Risk Assessment

| Risk | Mitigation | Verdict |
|------|------------|---------|
| Prompt injection via malicious examples | Examples are strings, not executable | Low risk |
| Disabled widget in prompt | `getEnabledManifests()` filters | ✅ Mitigated |
| Cross-user widget exposure | SQL filters by user_id | ✅ Mitigated |
| Unauthorized write operations | Phase 3.3 confirmation gating | ✅ Mitigated |

**Conclusion:** Fix is architecturally correct and maintains all security guarantees.

---

## Result

After the fix, "show demo" works correctly:

```
User: "show demo"
Assistant: [Recognizes panel_intent for demo-widget]
           [Calls /api/panels/demo-widget/list handler]
           [Returns demo items in chat]
```

---

## Key Takeaways

### 1. Visibility Filter Purpose

The visibility filter was designed for **physical dashboard panels**:
- Reduces LLM prompt size
- Provides context about what user can currently see
- Helps with ambiguous commands ("show quick links" → which panel?)

### 2. Custom Widgets Are Different

Custom widgets installed via Widget Manager:
- May not have physical dashboard panels (chat-only widgets)
- User explicitly installed them → should always be available
- Should bypass visibility filter

### 3. DB Manifest Tracking

The registry tracks which manifests came from DB:
```typescript
private dbManifestIds: Set<string> = new Set()

registerDBManifests(manifests: PanelChatManifest[]): void {
  // ... register manifests
  this.dbManifestIds.add(manifest.panelId)
}
```

This enables selective bypass of visibility filtering.

---

## Files Modified

| File | Change |
|------|--------|
| `lib/panels/panel-registry.ts` | Added `isDBManifest` check in `getVisibleIntents()` |

---

## Debug Approach Used

1. **Added console.log statements** to `intent-prompt.ts` (server-side)
2. **Logs appear in terminal** (where `npm run dev` runs), not browser console
3. **Traced the flow** from DB load → registry → prompt building
4. **Identified filter** as the point where manifests were lost
5. **Cleaned up debug logs** after fix verified

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        WIDGET MANIFEST FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Installation:                                                          │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐     │
│   │ manifest.json │ → │ Widget       │ → │ installed_widgets    │     │
│   │ (From File)   │   │ Manager API  │   │ table (DB)           │     │
│   └──────────────┘    └──────────────┘    └──────────────────────┘     │
│                                                                          │
│   Chat Request:                                                          │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐     │
│   │ "show demo"  │ → │ /api/chat/   │ → │ buildIntentMessages() │     │
│   │              │   │ navigate     │   │                        │     │
│   └──────────────┘    └──────────────┘    └──────────────────────┘     │
│                              ↓                                          │
│                    ┌──────────────────────────────────────────┐        │
│                    │ getEnabledManifests(userId)               │        │
│                    │  ↓                                        │        │
│                    │ registerDBManifests(manifests)            │        │
│                    │  ↓                                        │        │
│                    │ buildPromptSection(visiblePanelIds)       │        │
│                    │  ↓                                        │        │
│                    │ getVisibleIntents()                       │        │
│                    │  ├─ Built-in: filter by visibility        │        │
│                    │  └─ DB manifests: ALWAYS include ✅       │        │
│                    └──────────────────────────────────────────┘        │
│                              ↓                                          │
│                    ┌──────────────────────────────────────────┐        │
│                    │ LLM Prompt includes demo-widget intents   │        │
│                    │  ↓                                        │        │
│                    │ GPT recognizes "show demo" → panel_intent │        │
│                    └──────────────────────────────────────────┘        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Related Documents

- [Widget Manager Plan](../widget_manager/widget-manager-plan.md)
- [Panel Intent Registry Plan](../panel-intent-registry-plan.md)
- [Previous Fix: Demo Widget Chat Integration](./2025-01-02-demo-widget-chat-integration-fix.md)
