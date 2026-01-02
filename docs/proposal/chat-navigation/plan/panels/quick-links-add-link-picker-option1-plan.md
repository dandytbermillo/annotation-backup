# Plan: Option 1 — Handoff to Quick Links Panel + Open Picker

## Purpose
When a user says “add link to Quick Links C” in chat, confirm the write action, then **focus/highlight the Quick Links panel** and open the existing **“Link to Workspace” picker** inside that panel. This reuses the native UI and avoids a chat‑embedded picker.

## Anti‑Pattern Check
- Isolation/minimap reactivity anti‑patterns: **not applicable** (no isolation provider changes).

## Scope (What This Enables)
- Chat confirmation triggers the **existing Quick Links panel picker**.
- Panel is highlighted/focused so the user knows where to act.
- No new chat UI components or custom pickers.

## Non‑Goals
- No chat‑embedded picker UI.
- No server‑side TipTap content manipulation.
- No new global panel discovery beyond existing visibility rules.

---

## User Flow (Option 1)
1) User: “add link to quick links C”
2) Chat: confirmation pill → user confirms
3) System:
   - Brings Quick Links C panel into view (scroll + highlight)
   - Opens the “Link to Workspace” picker in that panel
4) User selects/creates workspace in picker
5) Picker closes, new link appears in Quick Links C
6) Chat: “Ready to add a link in Quick Links C.”

---

## Implementation Plan

### 1) Define a Picker‑Open Action (Client‑side)
- Add a **chat action** for panel write: `open_quick_links_picker`.
- Include payload:
  - `panelId` (workspace_panels id)
  - `badge` (A/B/C/D)
  - Optional: `panelTitle` for UI copy

### 2) Update Quick Links “add” API to return picker action
- File: `app/api/panels/quick-links/[badge]/add/route.ts`
- Replace stub message with a response like:
  - `success: true`
  - `action: "open_quick_links_picker"`
  - `panelId`, `badge`, `title`
- Reuse list route query to find the Quick Links panel (badge + user). Return panelId for highlight.

### 3) Chat Navigation: Dispatch events on action
- File: `lib/chat/use-chat-navigation.ts`
- Handle `open_quick_links_picker` by dispatching:
  - `highlight-dashboard-panel` (existing) with `panelId`
  - `chat-open-quick-links-picker` with `{ panelId, badge }`
- Provide a short success message for the chat bubble.

### 4) Quick Links Panel: Open picker on event
- File: `components/dashboard/panels/LinksNotePanelTiptap.tsx`
- Add `useEffect` listener for `chat-open-quick-links-picker`:
  - Validate `panelId` matches this panel
  - `setShowPicker(true)`
  - Optional: `setFilterByEntry(true)` and clear `searchQuery`

### 5) Focus/Highlight Behavior
- Use existing `highlight-dashboard-panel` to scroll/glow
- If panel is already active, just open picker (no scroll jump)

### 6) Fallbacks
- If panel not found for the badge:
  - Return a clear message: “Quick Links C isn’t on this dashboard. Open the panel first.”
- If panel is hidden/unmounted:
  - Same message + optional suggestion: “Open panel catalog → Quick Links C.”

---

## Data & Event Contract

### Event: `chat-open-quick-links-picker`
```
{ panelId: string, badge: string }
```

### Existing event used
- `highlight-dashboard-panel` with `{ panelId }`

---

## Testing Checklist

1) **Happy path**
- Prompt: “add link to quick links C” → confirm → picker opens in panel C

2) **Panel already visible**
- Picker opens without scrolling away unexpectedly

3) **Panel not found**
- Return guidance message (no crash)

4) **Cancel picker**
- User closes picker, chat remains stable

5) **Create link**
- New link appears in panel after selection

---

## Success Criteria
- Confirmed “add link” always opens the native picker.
- User never sees the “please open panel manually” stub when the panel exists.
- No new UI duplication; picker UX matches existing Quick Links behavior.

