# Dashboard Manual Test Script

**Feature:** Home Dashboard (Entry + Workspace Hierarchy)
**Phase:** 5.2 - Dogfooding & Internal Testing
**Prerequisites:** `NEXT_PUBLIC_NOTE_HOME_DASHBOARD=1` in `.env.local`

---

## Setup

```bash
# 1. Ensure Postgres is running
docker compose up -d postgres

# 2. Run migrations (if not already done)
npm run db:migrate

# 3. Start the dev server
npm run dev
```

---

## Test Cases

### TC-01: First Run - Dashboard Display

**Steps:**
1. Clear localStorage: `localStorage.clear()` in browser console
2. Refresh the page

**Expected:**
- [ ] Dashboard workspace loads automatically
- [ ] Default panels visible: Continue, Navigator, Recent, Quick Capture, Note
- [ ] Welcome tooltip appears (first visit)

---

### TC-02: Welcome Tooltip

**Steps:**
1. Observe welcome tooltip on first visit
2. Click "Got it" or dismiss button
3. Refresh page

**Expected:**
- [ ] Tooltip shows on first visit
- [ ] Tooltip does NOT reappear after dismissal
- [ ] `localStorage.getItem('dashboard_welcome_tooltip_seen')` returns `'true'`

---

### TC-03: Continue Panel - Empty State

**Steps:**
1. Clear `lastWorkspaceId` from localStorage
2. Observe Continue panel

**Expected:**
- [ ] Shows empty/neutral state
- [ ] Message like "No recent workspaces" or instructions to visit one

---

### TC-04: Continue Panel - Resume Workspace

**Steps:**
1. Navigate to a non-dashboard workspace
2. Return to dashboard (Cmd+Shift+H or click logo)
3. Observe Continue panel

**Expected:**
- [ ] Shows the workspace you just visited
- [ ] Displays workspace name and entry name
- [ ] "Continue" button is clickable
- [ ] Clicking button navigates to that workspace

---

### TC-05: Quick Capture - Create Note

**Steps:**
1. Click into Quick Capture textarea
2. Type: "Test quick capture note"
3. Press Cmd+Enter (or click submit)

**Expected:**
- [ ] Loading state appears briefly
- [ ] Success state with checkmark
- [ ] Toast notification with link to new note
- [ ] Textarea clears for next capture
- [ ] Note appears in Ideas Inbox (or configured destination)

---

### TC-06: Quick Capture - Error Handling

**Steps:**
1. Try to submit empty content
2. (Optional) Disconnect network, try to submit

**Expected:**
- [ ] Empty submission is prevented or shows validation
- [ ] Network error shows error message
- [ ] User input is preserved on error

---

### TC-07: Navigator Panel - Tree Display

**Steps:**
1. Observe Navigator panel
2. Click folder chevrons to expand/collapse

**Expected:**
- [ ] Entry tree loads with folders and notes
- [ ] Folders can be expanded/collapsed
- [ ] Icons display correctly (folder/note)
- [ ] Loading skeleton shows during fetch

---

### TC-08: Navigator Panel - Workspace Navigation

**Steps:**
1. Expand a folder with workspaces
2. Click on a workspace name

**Expected:**
- [ ] Navigates to selected workspace
- [ ] Breadcrumb updates to show entry/workspace path
- [ ] Canvas loads with workspace content

---

### TC-09: Recent Panel - Display

**Steps:**
1. Visit several workspaces
2. Return to dashboard
3. Observe Recent panel

**Expected:**
- [ ] Shows list of recently visited workspaces
- [ ] Most recent at top
- [ ] Limited to ~10 entries
- [ ] Each entry clickable

---

### TC-10: Recent Panel - Navigation

**Steps:**
1. Click on a workspace in Recent panel

**Expected:**
- [ ] Navigates to selected workspace
- [ ] Workspace loads correctly

---

### TC-11: Panel Management - Add Panel

**Steps:**
1. Click "+" button or "Add Panel"
2. Select a panel type from catalog
3. Confirm addition

**Expected:**
- [ ] Panel catalog shows available types with descriptions
- [ ] New panel appears on canvas
- [ ] Panel is draggable and resizable

---

### TC-12: Panel Management - Remove Panel

**Steps:**
1. Hover over a panel
2. Click close/delete button (X)
3. Confirm deletion if prompted

**Expected:**
- [ ] Panel is removed from canvas
- [ ] Removed panel persists after refresh (stays deleted)

---

### TC-13: Panel Management - Drag & Resize

**Steps:**
1. Drag a panel to new position
2. Resize a panel using handles
3. Refresh page

**Expected:**
- [ ] Panel moves smoothly
- [ ] Panel resizes correctly
- [ ] Position/size persists after refresh

---

### TC-14: Panel Management - Reset Layout

**Steps:**
1. Move/resize/delete some panels
2. Find and click "Reset Layout" action
3. Confirm reset

**Expected:**
- [ ] All panels return to default positions
- [ ] Default panels are restored if deleted
- [ ] Custom panels are removed (or kept, depending on design)

---

### TC-15: Keyboard Shortcut - Home Navigation

**Steps:**
1. Navigate to a non-dashboard workspace
2. Ensure cursor is NOT in an input field
3. Press Cmd+Shift+H (Mac) or Ctrl+Shift+H (Windows/Linux)

**Expected:**
- [ ] Navigates to dashboard
- [ ] Shortcut does NOT fire when typing in input/textarea

---

### TC-16: Breadcrumb Navigation

**Steps:**
1. Navigate to various workspaces
2. Observe breadcrumb component

**Expected:**
- [ ] Dashboard shows: "Home / Dashboard"
- [ ] Other workspaces show: "Entry Name / Workspace Name"
- [ ] Breadcrumb segments are clickable

---

### TC-17: Workspace Links in Note Panel

**Steps:**
1. In a Note panel, type `[[workspace:SomeName]]`
2. Or select text and press Cmd+K to link

**Expected:**
- [ ] Workspace link picker appears
- [ ] Can search/select workspace
- [ ] Link renders as clickable
- [ ] Clicking link navigates to workspace

---

### TC-18: Performance - Large Entry Tree

**Steps:**
1. Create many entries/folders (50+)
2. Open Navigator panel

**Expected:**
- [ ] Virtual scrolling activates for large trees
- [ ] Smooth scrolling without lag
- [ ] No visible jank during expand/collapse

---

## Telemetry Verification

After testing, check debug logs:

```sql
-- Check dashboard events logged
SELECT component, action, metadata, created_at
FROM debug_logs
WHERE component = 'Dashboard'
ORDER BY created_at DESC
LIMIT 20;
```

**Expected events:**
- [ ] `dashboard_load` on page load
- [ ] `panel_created` when adding panels
- [ ] `panel_deleted` when removing panels
- [ ] `quick_capture_submitted` on successful capture
- [ ] `continue_clicked` when using Continue panel
- [ ] `home_shortcut_used` for Cmd+Shift+H

---

## Sign-Off

| Tester | Date | Pass/Fail | Notes |
|--------|------|-----------|-------|
|        |      |           |       |

---

## Issues Found

| ID | Description | Severity | Status |
|----|-------------|----------|--------|
|    |             |          |        |
