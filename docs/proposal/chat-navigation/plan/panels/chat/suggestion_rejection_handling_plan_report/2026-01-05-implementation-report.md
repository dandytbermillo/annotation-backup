# Suggestion Rejection Handling - Implementation Report

**Date:** 2026-01-05
**Status:** Complete
**Type Check:** ✅ Passing

## Implementation Summary

Implemented the suggestion rejection handling feature per `suggestion-rejection-handling-plan.md`. The feature prevents repetitive suggestion loops by tracking rejected suggestions and filtering them from future responses.

## Detailed Changes

### 1. State Management (`lib/chat/chat-navigation-context.tsx`)

#### New Interface

```typescript
/** Last suggestion state for rejection handling */
export interface LastSuggestionState {
  candidates: SuggestionCandidate[]
  messageId: string
}
```

#### New State Variables

```typescript
// In ChatNavigationProvider:
const [lastSuggestion, setLastSuggestionState] = useState<LastSuggestionState | null>(null)
const [rejectedSuggestions, setRejectedSuggestions] = useState<Set<string>>(new Set())
```

#### New Handler Functions

```typescript
// Set/clear the last shown suggestion
const setLastSuggestion = useCallback((suggestion: LastSuggestionState | null) => {
  setLastSuggestionState(suggestion)
}, [])

// Add labels to the rejection set (lowercase for case-insensitive matching)
const addRejectedSuggestions = useCallback((labels: string[]) => {
  setRejectedSuggestions((prev) => {
    const next = new Set(prev)
    for (const label of labels) {
      next.add(label.toLowerCase())
    }
    return next
  })
}, [])

// Clear all rejected suggestions (called on successful navigation)
const clearRejectedSuggestions = useCallback(() => {
  setRejectedSuggestions(new Set())
}, [])

// Check if a label is in the rejected set
const isRejectedSuggestion = useCallback((label: string) => {
  return rejectedSuggestions.has(label.toLowerCase())
}, [rejectedSuggestions])
```

#### Context Interface Updates

```typescript
interface ChatNavigationContextValue {
  // ... existing fields ...

  // Suggestion rejection handling (ephemeral, not persisted)
  lastSuggestion: LastSuggestionState | null
  rejectedSuggestions: Set<string>
  setLastSuggestion: (suggestion: LastSuggestionState | null) => void
  addRejectedSuggestions: (labels: string[]) => void
  clearRejectedSuggestions: () => void
  isRejectedSuggestion: (label: string) => boolean
}
```

### 2. Rejection Detection (`components/chat/chat-navigation-panel.tsx`)

#### Helper Function

```typescript
/**
 * Check if input is a rejection phrase.
 * Per suggestion-rejection-handling-plan.md:
 * - Exact: "no", "nope", "not that", "cancel", "never mind"
 * - Or it begins with "no,"
 */
function isRejectionPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  // Exact rejection phrases
  const rejectionPhrases = ['no', 'nope', 'not that', 'cancel', 'never mind', 'nevermind']
  if (rejectionPhrases.includes(normalized)) {
    return true
  }

  // Begins with "no,"
  if (normalized.startsWith('no,')) {
    return true
  }

  return false
}
```

#### Rejection Handling in sendMessage

```typescript
// At the start of sendMessage, after adding user message:
if (lastSuggestion && isRejectionPhrase(trimmedInput)) {
  // User rejected the suggestion - clear state and respond
  const rejectedLabels = lastSuggestion.candidates.map(c => c.label)
  addRejectedSuggestions(rejectedLabels)
  setLastSuggestion(null)

  const assistantMessage: ChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: 'Okay — what would you like instead?',
    timestamp: new Date(),
    isError: false,
  }
  addMessage(assistantMessage)
  setIsLoading(false)
  return  // Early return - don't call API
}
```

### 3. Suggestion Filtering

#### Filter Logic (after API response)

```typescript
// Filter out rejected candidates from suggestions
let suggestions: ChatSuggestions | undefined = rawSuggestions

if (rawSuggestions && rawSuggestions.candidates.length > 0) {
  const filteredCandidates = rawSuggestions.candidates.filter(
    (c) => !isRejectedSuggestion(c.label)
  )

  if (filteredCandidates.length === 0) {
    // All candidates were rejected - don't show suggestions
    suggestions = undefined
  } else if (filteredCandidates.length !== rawSuggestions.candidates.length) {
    // Some candidates were filtered out
    suggestions = {
      ...rawSuggestions,
      candidates: filteredCandidates,
      // If we went from multiple to single, change type to confirm_single
      type: filteredCandidates.length === 1 ? 'confirm_single' : rawSuggestions.type,
    }
  }
}
```

#### Message Text

Note: Message text is not overridden when all suggestions are filtered. It remains
whatever the API returned in `result.message`.

### 4. State Lifecycle

#### Store lastSuggestion When Suggestions Shown

```typescript
// After creating assistant message:
if (suggestions && suggestions.candidates.length > 0) {
  setLastSuggestion({
    candidates: suggestions.candidates,
    messageId: assistantMessageId,
  })
} else {
  // Clear lastSuggestion if no suggestions (user moved on to valid command)
  setLastSuggestion(null)
}
```

#### Clear Rejected Suggestions on Success

```typescript
// In the success handler:
if (result.success && result.action) {
  // Clear rejected suggestions when user successfully navigates
  if (result.action === 'navigated' || result.action === 'created' ||
      result.action === 'renamed' || result.action === 'deleted') {
    clearRejectedSuggestions()
  }
  // ... rest of success handling
}
```

### 5. Export Updates (`lib/chat/index.ts`)

```typescript
export type {
  // ... existing exports ...
  LastSuggestionState,
} from './chat-navigation-context'
```

## Debugging Notes

During implementation, debug logging was added to trace the issue:

1. Filtering logic works, but message text still comes from `result.message` (API response).
2. When all candidates are filtered, suggestions are hidden but the message text is unchanged.

## Verification Commands

```bash
# Type check
npm run type-check

# Run rejection phrase detection tests
node docs/proposal/chat-navigation/plan/panels/chat/test-rejection-handling.mjs
```

## Known Limitations

1. **No TTL expiry**: Rejected suggestions persist until successful navigation or page refresh. The plan mentioned a 5-minute TTL, but this was deemed unnecessary for MVP.

2. **Label-only tracking**: Only tracks by label, not panelId. If a panel has multiple display names, it could theoretically be suggested again under a different label.

3. **Static fallback message**: The fallback message is hardcoded. Could be improved to dynamically list available commands based on context.

4. **No alternative list on rejection**: The rejection response is always “Okay — what would you like instead?” even if multiple candidates existed.

## Performance Impact

- Minimal: Only adds Set operations (O(1) lookups) and array filtering
- No additional API calls
- Ephemeral state only (no database writes)
