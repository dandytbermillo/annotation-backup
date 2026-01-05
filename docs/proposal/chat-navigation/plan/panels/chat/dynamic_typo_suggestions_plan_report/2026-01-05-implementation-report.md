# Dynamic Typo Suggestions - Implementation Report

**Date:** 2026-01-05
**Author:** Claude (AI Assistant)
**Status:** Complete

## Summary

Implemented dynamic typo suggestions to replace the hardcoded fallback ("Try: quick links, recent, workspaces") with context-aware suggestions built from panel registry manifests and visible panels.

## Changes Made

### 1. Core Vocabulary Expansion

**File:** `lib/chat/typo-suggestions.ts`

Updated Recent phrases to include verb variants:
```typescript
// Before
phrases: ['recent', 'recents', 'recent items', 'recently opened']

// After
phrases: ['recent', 'recents', 'recent items', 'recently opened',
          'open recent', 'show recent', 'list recent', 'view recent']
```

### 2. Dynamic Vocabulary from Manifests

**File:** `lib/chat/typo-suggestions.ts`

Added `buildDynamicVocabulary()` function that converts panel manifests to CommandDef entries:

```typescript
function buildDynamicVocabulary(manifests: PanelChatManifest[]): CommandDef[] {
  const dynamicCommands: CommandDef[] = []

  for (const manifest of manifests) {
    // Skip built-in panels (already in COMMAND_VOCABULARY)
    if (manifest.panelId === 'recent') continue
    if (manifest.panelId.startsWith('quick-links-')) continue

    // Build phrases from title and variations
    const phrases = [
      titleLower,
      `show ${titleLower}`,
      `open ${titleLower}`,
      `view ${titleLower}`,
      `my ${titleLower}`,
    ]

    dynamicCommands.push({
      phrases,
      label: title,
      primaryAction: 'open',
      intentName: 'panel_intent',
      panelId: manifest.panelId,
    })
  }

  return dynamicCommands
}
```

### 3. Quick Links Badge Variants from visiblePanels

**File:** `lib/chat/typo-suggestions.ts`

Added `buildVisibleQuickLinksVocabulary()` to extract Quick Links A/B/C/D from visible panels:

```typescript
function buildVisibleQuickLinksVocabulary(visiblePanels?: string[]): CommandDef[] {
  if (!visiblePanels) return []

  const quickLinksCommands: CommandDef[] = []

  for (const panelId of visiblePanels) {
    const match = panelId.match(/^quick-links-([a-z])$/i)
    if (!match) continue

    const badge = match[1].toUpperCase()
    quickLinksCommands.push({
      phrases: [
        `quick links ${badge.toLowerCase()}`,
        `show quick links ${badge.toLowerCase()}`,
        // ...
      ],
      label: `Quick Links ${badge}`,
      primaryAction: 'open',
      intentName: 'panel_intent',
      panelId,
    })
  }

  return quickLinksCommands
}
```

### 4. Merged Vocabulary Builder

**File:** `lib/chat/typo-suggestions.ts`

Added `getMergedVocabulary()` to combine all vocabulary sources:

```typescript
function getMergedVocabulary(context?: DynamicSuggestionContext): CommandDef[] {
  const vocabulary = [...COMMAND_VOCABULARY]

  // Add visible quick-links badge variants
  if (context?.visiblePanels) {
    vocabulary.push(...buildVisibleQuickLinksVocabulary(context.visiblePanels))
  }

  // Add dynamic commands from manifests
  if (context?.manifests?.length > 0) {
    vocabulary.push(...buildDynamicVocabulary(context.manifests))
  }

  return vocabulary
}
```

### 5. API Route Integration

**File:** `app/api/chat/navigate/route.ts`

Pass panel registry manifests to getSuggestions:

```typescript
const suggestionContext: DynamicSuggestionContext = {
  manifests: panelRegistry.getAll(),
  visiblePanels: context?.visiblePanels,
}

suggestions = getSuggestions(userMessage, suggestionContext)
```

### 6. Button Text Visibility Fix

**File:** `components/chat/chat-navigation-panel.tsx`

Fixed dark mode text visibility for outline badges:

```typescript
// Before
'border-dashed'

// After
'border-dashed text-muted-foreground'
```

## Validation

### Type-Check
```bash
$ npm run type-check
# No errors
```

### Fuzzy Matching Tests
```
Input: "vuew demo widgets"
  vs "view demo widget": score=0.950 ✓

Input: "oopen recent"
  vs "open recent": score=0.950 ✓

Input: "shwo quick links d"
  vs "show quick links d": score=0.950 ✓

Input: "wrkspaces"
  vs "workspaces": score=0.950 ✓
```

### Manual UI Tests
- [x] "pls vuew demo widgets" → Demo Widget (with content preview)
- [x] "oopen recent" → Recent (high confidence)
- [x] "shwo quick links d" → Quick Links D (high confidence)
- [x] Button text readable in dark mode

## Risks/Limitations

1. **Performance**: Building vocabulary on every request. Mitigated by small vocabulary size (~20 entries).

2. **visiblePanels dependency**: Quick Links badges only suggested if visiblePanels is passed from client. If missing, falls back to generic "Quick Links".

3. **Manifest loading timing**: Manifests must be loaded via `buildIntentMessages()` before `panelRegistry.getAll()` returns them.

## Next Steps

1. Monitor for false positive suggestions
2. Consider adding workspace names to vocabulary
3. Consider caching vocabulary per session
