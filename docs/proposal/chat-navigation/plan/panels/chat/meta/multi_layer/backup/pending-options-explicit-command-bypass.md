# Pending Options Guard: Explicit Command Bypass

## Goal
Prevent the pending-options guard from blocking explicit new commands (e.g., “open demo widget”), while still protecting disambiguation flows.

## Problem
When options are shown, the guard currently intercepts any input that doesn’t match an option, even if the user is issuing a new explicit command. This results in:
- User: “open demo widget”
- Bot: “Please choose one of these options.”

## Fix Summary
Add an explicit-command bypass so that if the input clearly starts a new command, the guard clears pending options and allows the message to proceed normally.

## Detection Rules (explicit command)
Treat the input as an explicit command if it contains any of:
- Action verbs: open, show, list, view, go, back, home, create, rename, delete, remove
- Intent keywords: workspace, entry, note, quick links, recent, dashboard, widget

## Behavior Changes

### Before
1. Options shown
2. User types “open demo widget”
3. Guard blocks, forcing selection

### After
1. Options shown
2. User types “open demo widget”
3. Guard bypasses
4. pendingOptions cleared
5. Message proceeds to normal routing

## Implementation Steps
1. Add `isExplicitCommand(input)` helper
2. In the pending-options guard:
   - if `isExplicitCommand(input)` → clear `pendingOptions` and continue
   - else keep existing guard behavior

## UX Copy
No new copy needed; user sees the normal response to their explicit command.

## Acceptance Tests
1) Options shown → “open demo widget” should open demo widget (no guard message)
2) Options shown → “go home” should navigate home
3) Options shown → “first one” should still select option
4) Options shown → random text should still show “Please choose one”

## Files to Touch
- `components/chat/chat-navigation-panel.tsx`

