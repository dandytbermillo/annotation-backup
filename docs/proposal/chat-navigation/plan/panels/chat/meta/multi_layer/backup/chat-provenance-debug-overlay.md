# Dev-Only Chat Provenance Debug Overlay

## Context

During development, there's no way to tell from the chat UI whether a response was handled deterministically, auto-executed by LLM, or LLM-influenced (safe clarifier with reorder). This makes debugging routing behavior opaque. The user needs a visual overlay showing the provenance of each assistant response — strictly dev-only, zero production leakage.

## Approach: Sidecar Map + Inline Badge

A sidecar `Map<string, Provenance>` keyed by the **assistant message ID**, with an inline badge rendered in `ChatMessageList`. No modification to `ChatMessage` schema. Set provenance at ONE place: the routing outcome boundary in `sendMessage`, using a context-level `lastAddedAssistantIdRef` that the provider's `addMessage` updates automatically.

### Provenance Values

| Value | Meaning | Badge |
|-------|---------|-------|
| `deterministic` | Rule-based (badge, ordinal, exact label, scope-cue, known-noun, command) | `✅ Deterministic` (green) |
| `llm_executed` | LLM called + `autoExecute=true` | `🧠 Auto-Executed` (blue) |
| `llm_influenced` | LLM called + clarifier/reorder/loop-guard continuity | `✅🧠 LLM-Influenced` (yellow) |

### Feature Flag

Hard dev-only gate — **both** conditions required:

```typescript
export function isProvenanceDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG === 'true'
    && process.env.NODE_ENV !== 'production'
}
```

Default OFF. Document flag usage in comments, NOT in `.env.local`.

---

## Step 1: Add provenance type + state to context

**File:** `lib/chat/chat-navigation-context.tsx`

Add type near line 295:

```typescript
export type ChatProvenance = 'deterministic' | 'llm_executed' | 'llm_influenced'
```

Add feature flag helper (hard dev-only gate):

```typescript
/** Dev-only: requires flag ON + non-production environment */
export function isProvenanceDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG === 'true'
    && process.env.NODE_ENV !== 'production'
}
```

Add to `ChatNavigationContextValue` interface:

```typescript
provenanceMap: Map<string, ChatProvenance>
setProvenance: (messageId: string, provenance: ChatProvenance) => void
clearProvenanceMap: () => void
```

Add state + tracking ref in provider:

```typescript
const [provenanceMap, setProvenanceMap] = useState<Map<string, ChatProvenance>>(new Map())
const setProvenance = useCallback((messageId: string, provenance: ChatProvenance) => {
  setProvenanceMap(prev => { const next = new Map(prev); next.set(messageId, provenance); return next })
}, [])
const clearProvenanceMap = useCallback(() => setProvenanceMap(new Map()), [])

// Context-level ref: tracks the ID of the last assistant message added via addMessage.
// This is the key to the blocker fix — handleSelectOption calls addMessage from its closure
// (the context's addMessage, not any local wrapper), so tracking must live HERE.
const lastAddedAssistantIdRef = useRef<string | null>(null)
```

Augment the existing `addMessage` (line ~782) — add tracking at the top:

```typescript
const addMessage = useCallback(async (message: ChatMessage) => {
  // Dev provenance: track last assistant message ID for post-hoc tagging
  if (isProvenanceDebugEnabled() && message.role === 'assistant') {
    lastAddedAssistantIdRef.current = message.id
  }
  // ... existing addMessage logic (setMessages, persist) unchanged ...
}, [...])
```

Expose in context value:

```typescript
provenanceMap,
setProvenance,
clearProvenanceMap,
lastAddedAssistantIdRef,   // ref, not state — zero re-renders, zero cost when disabled
```

---

## Step 2: Clear sidecar on lifecycle boundaries

**File:** `components/chat/chat-navigation-panel.tsx`

Call `clearProvenanceMap()` wherever `clearMessages` / conversation reset happens:
- `handleClearChat` (or equivalent clear function)
- Any session reset / exit pill that clears all messages

This prevents stale badges from a previous conversation leaking into a new one.

---

## Step 3: Pass `_devProvenanceHint` through `ClarificationInterceptResult`

**File:** `lib/chat/chat-routing.ts`

The clarification intercept handles the LLM paths. The dispatcher lumps everything under `tierLabel: 'clarification_intercept'` so we need a finer signal.

Add to the return type of `handleClarificationIntercept` (currently `{ handled, clarificationCleared, isNewQuestionOrCommandDetected }`):

```typescript
_devProvenanceHint?: ChatProvenance
```

Set it at **only 4 sites** (the LLM-specific return paths):

1. **Tier 1b.3 auto-execute** (line ~4077): `_devProvenanceHint: 'llm_executed'`
2. **Tier 1b.3 safe clarifier** (line ~4121): `_devProvenanceHint: llmResult.suggestedId ? 'llm_influenced' : 'deterministic'`
3. **Scope-cue auto-execute** (line ~2779): `_devProvenanceHint: 'llm_executed'`
4. **Scope-cue safe clarifier** (line ~2840): `_devProvenanceHint: llmResult.suggestedId ? 'llm_influenced' : 'deterministic'`

All other return paths → no `_devProvenanceHint` (undefined → treated as `'deterministic'`).

---

## Step 4: Pass hint through `RoutingDispatcherResult`

**File:** `lib/chat/routing-dispatcher.ts`

Add to `RoutingDispatcherResult` (line ~239):

```typescript
_devProvenanceHint?: ChatProvenance
```

At the `clarification_intercept` return (line ~1057), pass it through:

```typescript
_devProvenanceHint: clarificationResult._devProvenanceHint,
```

For other tiers that use LLM (grounding LLM at Tier 4.5):
- `grounding_llm_select` / `grounding_llm_referent_execute` / `grounding_llm_widget_item_execute`: `_devProvenanceHint: 'llm_executed'`
- `grounding_llm_fallback_clarifier` / `grounding_llm_need_more_info`: `_devProvenanceHint: 'llm_influenced'`
- All other tiers: omit (defaults to `'deterministic'`)

---

## Step 5: Atomic provenance attribution at routing outcome boundary

**File:** `components/chat/chat-navigation-panel.tsx`

**Context-level ref approach** — no `messages.findLast()`, no React timing issues, no local wrapper that `handleSelectOption` can bypass.

Why the local wrapper approach fails: `handleSelectOption` is a `useCallback` that captures `addMessage` from the context provider's closure. Auto-execute calls `handleSelectOption` → `addMessage(assistantMsg)` INSIDE `dispatchRouting`, before it returns. A local `addMessageWithTracking` wrapper passed to `dispatchRouting` is never seen by `handleSelectOption`. The context-level `lastAddedAssistantIdRef` (set in Step 1's augmented `addMessage`) catches ALL `addMessage` calls regardless of call site.

**Before `dispatchRouting`** — reset the ref (line ~1447):

```typescript
// Dev provenance: reset tracking for this routing cycle
if (isProvenanceDebugEnabled()) {
  lastAddedAssistantIdRef.current = null
}
```

**After `dispatchRouting` returns** (line ~1518):

```typescript
// Dev provenance: tag the assistant message that was added during this routing cycle.
// lastAddedAssistantIdRef was set by addMessage (context-level) — works even when
// the message came from handleSelectOption (auto-execute path).
if (isProvenanceDebugEnabled() && routingResult.handled && lastAddedAssistantIdRef.current) {
  setProvenance(lastAddedAssistantIdRef.current, routingResult._devProvenanceHint ?? 'deterministic')
}
```

**LLM API fallthrough** (line ~1811+), after the response message is added:

```typescript
if (isProvenanceDebugEnabled() && lastAddedAssistantIdRef.current) {
  setProvenance(lastAddedAssistantIdRef.current, 'llm_executed')
}
```

**Flow trace for auto-execute (the previously-broken path):**
1. `sendMessage` resets `lastAddedAssistantIdRef.current = null`
2. `dispatchRouting` → `handleClarificationIntercept` → `tryLLMLastChance` returns `autoExecute: true`
3. Auto-execute branch calls `handleSelectOption(option)`
4. `handleSelectOption` → `addMessage(assistantMsg)` → context's `addMessage` sets `lastAddedAssistantIdRef.current = msg.id`
5. `dispatchRouting` returns `{ handled: true, _devProvenanceHint: 'llm_executed' }`
6. `sendMessage` tags `lastAddedAssistantIdRef.current` with `'llm_executed'` ✅

No changes to `dispatchRouting` signature. No wrapper passed. `addMessage` is not replaced.

---

## Step 6: Render badge in ChatMessageList

**File:** `components/chat/ChatMessageList.tsx`

Add `provenanceMap` to props:

```typescript
export interface ChatMessageListProps {
  // ... existing ...
  /** Dev-only: routing provenance per assistant message ID */
  provenanceMap?: Map<string, ChatProvenance>
}
```

After the message bubble div (line ~159), render badge for assistant messages:

```typescript
{/* Dev-only: Provenance debug badge */}
{provenanceMap && message.role === 'assistant' && provenanceMap.has(message.id) && (
  <ProvenanceBadge provenance={provenanceMap.get(message.id)!} />
)}
```

Inline the badge component at the top of the file (no new file):

```typescript
import type { ChatProvenance } from '@/lib/chat'

const PROVENANCE_STYLES: Record<ChatProvenance, { emoji: string; label: string; className: string }> = {
  deterministic: { emoji: '✅', label: 'Deterministic', className: 'bg-green-900/50 text-green-300 border-green-600/30' },
  llm_executed: { emoji: '🧠', label: 'Auto-Executed', className: 'bg-blue-900/50 text-blue-300 border-blue-600/30' },
  llm_influenced: { emoji: '✅🧠', label: 'LLM-Influenced', className: 'bg-yellow-900/50 text-yellow-300 border-yellow-600/30' },
}

function ProvenanceBadge({ provenance }: { provenance: ChatProvenance }) {
  const style = PROVENANCE_STYLES[provenance]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${style.className} mt-1`}>
      {style.emoji} {style.label}
    </span>
  )
}
```

---

## Step 7: Pass map through props at render site

**File:** `components/chat/chat-navigation-panel.tsx` (line ~2779)

```typescript
<ChatMessageList
  messages={messages}
  // ... existing props ...
  provenanceMap={isProvenanceDebugEnabled() ? provenanceMap : undefined}
/>
```

---

## Step 8: Tests

### 8a. Routing tests — `_devProvenanceHint` correctness

**File:** `__tests__/unit/chat/selection-vs-command-arbitration.test.ts`

Add to existing Phase C tests:

- Auto-execute test: assert `result._devProvenanceHint === 'llm_executed'`
- Safe clarifier with LLM suggestion test: assert `result._devProvenanceHint === 'llm_influenced'`
- Safe clarifier without LLM suggestion (LLM disabled): assert `result._devProvenanceHint === undefined` (deterministic)

### 8b. UI test — badge visibility gated by flag

**File:** `__tests__/unit/chat/provenance-badge.test.tsx` (new, small)

```typescript
// Test 1: provenanceMap provided → badge renders with correct class
// Test 2: provenanceMap undefined (production) → no badge renders
// Test 3: provenanceMap provided but message.id not in map → no badge
```

Use `@testing-library/react` `render` + `screen.queryByText`.

### 8c. Auto-execute attribution test (MUST-HAVE — validates blocker fix)

**File:** `__tests__/unit/chat/selection-vs-command-arbitration.test.ts`

Add to existing Phase C auto-execute test:

```typescript
// Verify: auto-execute path where handleSelectOption produces the assistant message
// still gets llm_executed provenance hint on the routing result.
// The test asserts _devProvenanceHint === 'llm_executed' AND handleSelectOption was called.
// This proves the message added by handleSelectOption can be tagged post-hoc
// using the routing result's hint + lastAddedAssistantIdRef.
```

The unit test asserts the routing result carries `_devProvenanceHint: 'llm_executed'` even though the message was produced by `handleSelectOption` (not directly by the routing code). Combined with the context-level ref tracking, this guarantees correct badge attribution.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/chat/chat-navigation-context.tsx` | `ChatProvenance` type, `provenanceMap` state, `setProvenance`, `clearProvenanceMap`, `isProvenanceDebugEnabled()`, `lastAddedAssistantIdRef` (context-level tracking in `addMessage`) |
| `lib/chat/chat-routing.ts` | `_devProvenanceHint` on 4 LLM return paths |
| `lib/chat/routing-dispatcher.ts` | `_devProvenanceHint` passthrough on `RoutingDispatcherResult` + grounding LLM tiers |
| `components/chat/chat-navigation-panel.tsx` | Reset/tag `lastAddedAssistantIdRef` around dispatch, clear provenance on lifecycle, pass map to renderer |
| `components/chat/ChatMessageList.tsx` | `provenanceMap` prop, `ProvenanceBadge` inline component |
| `__tests__/unit/chat/selection-vs-command-arbitration.test.ts` | Assert `_devProvenanceHint` on existing Phase C tests |
| `__tests__/unit/chat/provenance-badge.test.tsx` | New: badge visibility gated by flag |

**Total: ~90 lines added, 4 return paths annotated, 1 small new test file, 1 must-have attribution test.**

## Verification

```bash
# Type check
npx tsc --noEmit

# Run all tests
npx jest __tests__/unit/chat/selection-vs-command-arbitration.test.ts --no-coverage --runInBand
npx jest __tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts --no-coverage --runInBand
npx jest __tests__/unit/chat/provenance-badge.test.tsx --no-coverage --runInBand
```

Manual test:
1. Set `NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG=true` in `.env.local` (dev mode)
2. `open links panel` → disambiguation → badge shows `✅ Deterministic`
3. `can you ope panel d pls` (with auto-execute ON) → badge shows `🧠 Auto-Executed`
4. `can you ope panel d pls` (with auto-execute OFF) → clarifier → badge shows `✅🧠 LLM-Influenced`
5. Remove flag → no badges visible
6. `NODE_ENV=production` with flag ON → no badges visible (hard gate)
7. Clear chat → provenance map cleared, no stale badges
