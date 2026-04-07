# Pending Options Re-Show (Grace Window)

## Goal
Let users re-open the last disambiguation options for a short period after a selection (e.g., when they say “show me the options” or “I’m confused”). This avoids confusing fallback suggestions once options were just shown.

## Problem
After a user selects an option, `pendingOptions` are cleared. If the user later says “show me the options,” the chat falls back to typo suggestions and unrelated defaults.

## Approach
Add a short-lived “last options” cache that survives selection for a grace window (e.g., 30–60 seconds). If the user asks to re-show options during this window, re-render the pills without re-calling the LLM.

## Minimal Changes

### 1) Track last options + timestamp
- Store `{ options, message, createdAt }` whenever a disambiguation list is shown.
- Keep it even after selection (do not clear immediately).

### 2) Add grace window check
- Define `RESHOW_WINDOW_MS` (suggest 60_000).
- On input, if it matches “re-show” intent and `now - lastOptions.createdAt <= RESHOW_WINDOW_MS`, re-render options.

### 3) Fallback when expired
- If the grace window has expired, respond with a short prompt:
  - “No options are open. Say ‘show quick links’ to see them again.”

### 4) LLM reshow_options handler update
- When the API returns `action: "reshow_options"`:
  - If `pendingOptions` is empty but `lastOptions` exists and is within the grace window, re-render `lastOptions`.
  - Otherwise, return the standard “No options are open…” response.

## Triggers (user phrases)
- “show me the options”
- “show the options”
- “show options”
- “what were those?”
- “I’m confused”
- “can you show me again?”

(Keep this list small; LLM fallback still handles fuzzy phrasing.)

## UX Rules
- Do not call the LLM when re-showing.
- Do not re-open if there was no prior disambiguation.
- If options are currently visible, just re-render (idempotent).

## Acceptance Tests
1) **Selection then re-show**
   - User: “quick links” → disambiguation pills
   - User: select “Quick Links D”
   - User: “show me the options” → same pills reappear

2) **Grace window expired**
   - Wait > 60s
   - User: “show me the options” → “No options are open…”

3) **No prior options**
   - User: “show me the options” → “No options are open…”

4) **LLM-driven re-show**
   - User: “I’m confused” (not matched by deterministic triggers)
   - LLM returns `reshow_options`
   - Options re-render if within grace window

## Files to Touch (expected)
- `lib/chat/chat-navigation-context.tsx`
  - store lastOptions state
- `components/chat/chat-navigation-panel.tsx`
  - re-show trigger check
  - grace window handling
  - reshow_options handling

