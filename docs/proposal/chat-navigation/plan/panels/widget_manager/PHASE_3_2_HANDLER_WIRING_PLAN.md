# Phase 3.2: Widget Bridge Handler Wiring (Read-Only)

**Date:** 2026-01-03  
**Status:** Draft (Ready for Implementation)  
**Prerequisite:** Phase 3.1 complete (sandbox + bridge + permissions infra)

---

## Context & Lesson Applied

The Demo Widget incident showed that **server-side registry is the source of truth** for chat intent prompts. Phase 3.2 does not add or mutate manifests on the client. It is strictly host-side wiring so sandboxed widgets can read workspace/note state through the existing bridge.

**Isolation reactivity anti-patterns:** Not applicable here; this phase does not modify isolation context, does not introduce new `useSyncExternalStore` hooks, and does not bind UI to unproven provider APIs.

---

## Goals

1. Enable sandboxed widgets to **read** workspace + note state via `WidgetBridge`.
2. Keep permissions enforced (read-only methods map to `read:*` permissions).
3. Avoid server/client registry mismatches (handlers live in host UI only).

## Non-Goals

- Write APIs (Phase 3.3)
- Permission persistence (“Always Allow”) wiring (Phase 3.3)
- Widget SDK packaging (Phase 3.4)
- Server-side widget code execution

---

## Bridge Methods (Read-Only)

**Workspace**
- `workspace.getPanels` → list visible panels (ids, types, titles)
- `workspace.getActivePanel` → active panel id + type

**Notes**
- `notes.getCurrentNote` → current note id + title + content preview
- `notes.getNote` → note by id (read-only)

These methods are already defined in `lib/widgets/sandbox-permissions.ts` and must be implemented via host handlers.

---

## Architecture (High Level)

```
Widget iframe
  → postMessage request: workspace.getPanels
Host (WidgetSandboxHost)
  → SandboxBridge permission check (read:workspace)
  → Handler executes against host state (client)
  → Response returned to widget
```

---

## Implementation Plan

### 1) Create Read-Only Bridge Handlers

**New files**
- `lib/widgets/bridge-api/workspace.ts`
- `lib/widgets/bridge-api/notes.ts`
- `lib/widgets/bridge-api/index.ts`

**Responsibilities**
- Implement each handler as a pure async function.
- Input: current UI state (workspace, active panel, notes).
- Output: minimal read-only payloads (no secrets; no write capability).

**Payload shape (example)**
```ts
// workspace.getPanels
{
  panels: [{ id, type, title, isActive }]
}
```

### 2) Build Handlers From Host State

**New hook**
- `lib/widgets/use-sandbox-handlers.ts`

**Purpose**
- Assemble handler functions using existing UI state (dashboard/workspace state, note state).
- Ensure the hook does not introduce new subscriptions or unstable providers.

**Integration points (to confirm in code)**
- Dashboard view: current panels and active panel
- Workspace view: active note + note content

### 3) Wire Handlers Into WidgetSandboxHost

**Modify**
- `components/widgets/WidgetSandboxHost.tsx`
  - Consume `useSandboxHandlers()` in the parent that renders the sandbox host.
  - Pass `handlers` into `SandboxBridge` config.

### 4) Permission Alignment (Read-Only)

**No changes needed** to permission map; read methods already map to `read:workspace` and `read:notes`.

### 5) Minimal Unit Tests (Optional but Recommended)

**Tests**
- `__tests__/unit/widgets/bridge-api-workspace.test.ts`
- `__tests__/unit/widgets/bridge-api-notes.test.ts`

Focus: handler output shape and null safety.

---

## Acceptance Criteria

- [ ] `workspace.getPanels` returns visible panel list in both dashboard and workspace modes.
- [ ] `workspace.getActivePanel` returns correct active panel id/type.
- [ ] `notes.getCurrentNote` returns current note when a note is open; returns `null` safely when none.
- [ ] `notes.getNote` returns a note by id (read-only) or `null` if missing.
- [ ] Permission checks are enforced (read-only methods do not trigger approval prompt).
- [ ] Type-check passes.

---

## Manual Test Checklist

1. Install sandbox widget with `read:workspace` permission.
2. Add widget instance to dashboard.
3. From widget, call `workspace.getPanels`:
   - Expect list includes widgets currently visible.
4. Open a workspace note; call `notes.getCurrentNote`:
   - Expect id + title + preview.
5. Call `notes.getNote` with invalid id:
   - Expect `null` or a clear error object.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Handler uses unstable state sources | Prefer existing, stable state accessors used by UI |
| Overexposure of data | Return minimal fields; no full note bodies unless needed |
| Context mismatch in workspace vs dashboard | Guard by view mode; return empty list when unavailable |

---

## Files Summary

**Create**
- `lib/widgets/bridge-api/workspace.ts`
- `lib/widgets/bridge-api/notes.ts`
- `lib/widgets/bridge-api/index.ts`
- `lib/widgets/use-sandbox-handlers.ts`

**Modify**
- `components/widgets/WidgetSandboxHost.tsx`

---

## Notes

- Keep this phase strictly read-only to avoid permission persistence complexity (Phase 3.3).
- Do not add any client-side manifest registration; chat manifests remain server-side.
