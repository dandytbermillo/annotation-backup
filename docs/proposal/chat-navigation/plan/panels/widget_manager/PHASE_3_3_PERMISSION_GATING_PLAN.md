# Phase 3.3: Permission Gating + Write APIs

**Date:** 2026-01-03
**Status:** Complete (MVP - Dashboard Context)
**Prerequisite:** Phase 3.1 + Phase 3.2 complete

---

## Context & Lesson Applied

The Demo Widget issue proved that server-side sources of truth must be used for chat and widget state. This phase follows that: permission grants are persisted server-side and loaded on widget mount, not kept only in client memory.

**Isolation reactivity anti-patterns:** Not applicable. No new isolation hooks or provider changes are introduced here.

---

## Goals

1. Enable **write-capable** bridge methods with user approval gating.
2. Persist **Always Allow / Always Deny** decisions per widget instance and user.
3. Load persistent grants on widget mount and enforce on every write call.

## Non-Goals

- New sandbox CSP changes (Phase 3.1)
- Read-only handlers (Phase 3.2)
- Network fetch handler (defer to Phase 3.3b/3.4)
- SDK packaging (Phase 3.4)
- Server-side widget execution

---

## Existing Foundation

- Table: `widget_permission_grants` (Phase 3.1 migration).
- Bridge logic: `SandboxBridge` already checks declared permissions and supports `setPersistentGrants()`.
- Session-only grants already stored in memory via `recordSessionGrant()`.

---

## Write APIs (Bridge Methods)

**Workspace**
- `workspace.openPanel` (write:workspace)
- `workspace.closePanel` (write:workspace)
- `workspace.focusPanel` (write:workspace)

**Notes**
- `notes.updateNote` (write:notes)
- `notes.createNote` (write:notes)
- `notes.deleteNote` (write:notes)

**Chat**
- `chat.sendMessage` (write:chat)

---

## Data Model

Use the existing `widget_permission_grants` table:

- `widget_instance_id`
- `user_id`
- `permission`
- `allow_level`: `once | always | never`
- `expires_at`: null for `always`/`never`, optional for `once`

**Persistence policy**
- `always` and `never` are persisted.
- `once` remains **session-only** (stored in memory).

---

## API Contracts

### GET /api/widgets/permissions?widgetInstanceId=...
Returns persistent grants for the instance.

Response:
```json
{
  "grants": [
    { "permission": "write:notes", "allowLevel": "always" }
  ]
}
```

### POST /api/widgets/permissions
Persist a grant decision.

Request:
```json
{
  "widgetInstanceId": "uuid",
  "permission": "write:notes",
  "allowLevel": "always"
}
```

Response:
```json
{ "success": true }
```

---

## Implementation Plan

### 1) Permission Store Helpers

**New file**
- `lib/widgets/permission-store.ts`

**Functions**
- `listPermissionGrants(widgetInstanceId, userId)`
- `upsertPermissionGrant(widgetInstanceId, userId, permission, allowLevel)`

### 2) API Endpoints

**New files**
- `app/api/widgets/permissions/route.ts` (GET + POST)

### 3) WidgetSandboxHost Integration

**Modify**
- `components/widgets/WidgetSandboxHost.tsx`

**Behavior**
- On mount: fetch persistent grants and call `bridge.setPersistentGrants(grants)`.
- On permission prompt decision:
  - `always` / `never`: call POST /api/widgets/permissions
  - `allow` / `deny`: keep session-only (no DB write)

**UI note**
- Reuse the existing inline `PermissionDialog` already defined in `WidgetSandboxHost.tsx`.
- `onPermissionRequest` is the persistence boundary for always/never decisions.

### 4) Bridge Handlers (Write)

**New files**
- `lib/widgets/bridge-api/workspace-write.ts`
- `lib/widgets/bridge-api/notes-write.ts`
- `lib/widgets/bridge-api/chat-write.ts`

**Wire into**
- `lib/widgets/use-sandbox-handlers.ts`

### 5) Security Rules

- Always verify:
  - Method is declared in manifest
  - Permission is declared in manifest
  - Permission grant exists (or session grant) for write methods
- Never execute write handlers without approval
- Rate-limit write methods per widget instance (e.g., 10 ops/min); return a clear `RATE_LIMITED` error

---

## Acceptance Criteria

### MVP (Dashboard Context)
- [ ] Write methods prompt user for approval on first use.
- [ ] "Always allow" persists across reloads.
- [ ] "Always deny" persists across reloads.
- [ ] "Allow once" resets on reload.
- [ ] Permission checks run before every write method.
- [ ] Rate limit enforced for write methods.
- [ ] Type-check passes.

### Full Phase 3.3 (All Contexts)
- [ ] workspace.openPanel executes real action (not stubbed).
- [ ] notes.* execute real actions with note context.
- [ ] chat.sendMessage executes real action.

---

## Manual Test Checklist

1. Call `workspace.openPanel` from widget:
   - Prompt appears.
2. Choose **Always Allow**:
   - Call succeeds.
   - Reload page; call succeeds without prompt.
3. Choose **Always Deny**:
   - Call denied.
   - Reload page; call denied without prompt.
4. Choose **Allow Once**:
   - Call succeeds.
   - Reload page; prompt appears again.

---

## Notes

- This phase is write-capable; keep read-only handlers unchanged.
- Permission persistence is per widget instance and user.

---

## MVP Completion (2026-01-04)

### Implemented

- Permission persistence: `lib/widgets/permission-store.ts`, `app/api/widgets/permissions/route.ts`
- Permission loading on mount + always/never persist: `components/widgets/WidgetSandboxHost.tsx`
- Rate limiting with real widget instance ID: `lib/widgets/use-sandbox-handlers.ts`
- Write callbacks wired in dashboard: `components/dashboard/DashboardWidgetRenderer.tsx`
- Real actions: `workspace.focusPanel`, `workspace.closePanel`

### Deferred (Future Phase)

| Method | Status | Reason |
|--------|--------|--------|
| `workspace.openPanel` | Stub (returns false) | Requires panel creation logic |
| `notes.*` | Stub (returns false) | Widgets render on dashboard only, no note context |
| `chat.sendMessage` | Stub (returns null) | Requires chat system integration |

### Rationale

Sandbox widgets only render on the dashboard (`DashboardWidgetRenderer` → `SandboxWidgetPanel`). There is no workspace-view rendering path for widgets, so notes context is unavailable. The permission gating infrastructure is complete; the stubs represent an architectural boundary.
