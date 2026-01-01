# Draft: Close Panel Intent Registry Gaps (Permissions + Visibility + Collisions)

## Purpose
Address remaining gaps after panel‑intent registry implementation:
1) Permission enforcement for write intents
2) Visibility/focus‑aware intent prioritization
3) Collision handling with core intents (e.g., show_quick_links)

---

## Gap 1: Permission Enforcement

### Current
`executePanelIntent()` supports permission checks, but `resolvePanelIntent` never enforces them, so write intents run without confirmation.

### Implementation Plan
1) **Lookup permission**
   - Use `panelRegistry.findIntent()` to read `permission` for the intent.
2) **If permission === 'write' → return confirmation**
   - New action: `confirm_write`
   - Response includes a confirm pill (similar to delete confirmation).
3) **On confirm**
   - Re‑run the same panel intent with a `bypassConfirmation: true` flag (stored in selection data).

### UX Spec
- Initial response: “This action will modify data. Continue?”
- Confirm pill: “Confirm”
- Cancel pill: “Cancel”

### File Touchpoints
- `lib/chat/intent-resolver.ts`: add confirm_write flow for panel_intent
- `components/chat/chat-navigation-panel.tsx`: render confirm pill; on click, re‑dispatch with bypass flag

---

## Gap 2: Visibility & Focus (Client → Server State)

### Current
`panelRegistry` is a server‑side singleton. Client calls to `setVisiblePanels()` do **not** affect the server’s prompt generation. This means visibility/focus rules are currently ineffective.

### Implementation Plan (Recommended)
**Pass visibility in the request**
- Add `visiblePanels: string[]` and `focusedPanelId?: string` to the chat request body.
- Update `buildPromptSection(visiblePanels, focusedPanelId)` to filter and prioritize intents server‑side.
- Server should **intersect** with known panel IDs and ignore unknown IDs for safety.

### Client Integration Points
- Dashboard: when panels are known/loaded, compute visible panel IDs and pass in chat requests.
- Panel focus: when user clicks a panel, update `focusedPanelId` in chat state.
- Chat open: reset focus to `null`.

### File Touchpoints
- `components/chat/chat-navigation-panel.tsx`: include visiblePanels + focusedPanelId in API body
- `lib/chat/intent-prompt.ts`: accept these in ConversationContext and call `buildPromptSection(...)`
- `lib/panels/panel-registry.ts`: update `buildPromptSection` to accept parameters

---

## Gap 3: Core Intent Collision (show_quick_links)

### Current
Core intent `show_quick_links` overlaps with panel_intent for Quick Links.

### Implementation Plan (Hybrid Priority)
1) **Prompt rule**
   - If user mentions a badge (A/B/C/D), prefer `panel_intent`.
2) **Resolver reroute**
   - If `show_quick_links` resolves and includes badge → reroute to `panel_intent` internally.

### File Touchpoints
- `lib/chat/intent-prompt.ts`: add badge‑priority rule
- `lib/chat/intent-resolver.ts`: reroute show_quick_links → panel_intent when badge present

---

## Testing Checklist
- “add link to quick links C” → confirm_write pill → executes on confirm
- “clear recent” → confirm_write pill → executes on confirm
- Focused panel intent wins over another visible panel
- “show quick links C” routes to panel_intent (not core)

---

## Success Criteria
- Write intents require confirmation
- Prompt only includes visible/focused panels (client → server)
- Reduced collisions between core and panel intents
