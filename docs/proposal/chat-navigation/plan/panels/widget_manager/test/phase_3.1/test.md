# Plan: Widget Manager (Custom Widgets + Auto Chat Integration)

**Date:** 2025-01-02
**Status:** Draft
**Scope:** Provide a Widget Manager that lets users install widgets without code and auto-enable chat capabilities safely.

---

## Lesson Applied (from Demo Widget Fix)
The Demo Widget failed initially because client-side manifest registration did not reach the server-side registry.

**Constraint:** All chat-intent manifests used by the LLM **must be available on the server** at request time. Any client-only registration is insufficient.

This plan enforces a server-visible manifest store and a server-side loader on each chat request (or cached with invalidation).

---

## Goals
- Users can install widgets via URL/file/store with no code changes.
- Installed widgets automatically become chat-aware.
- Chat uses only server-visible manifests to avoid client/server mismatch.
- Widgets are safe, scoped, and permissioned.
- Widget state and enable/disable status persist per user.

## Non-Goals (v1)
- Running arbitrary untrusted code without sandboxing.
- Global widget marketplace (curation can come later).
- Complex permission systems beyond read/write for chat actions.

---

## Architecture Overview

```
User installs widget -> Widget Manager validates -> Stored in DB
                                |                   |
                                v                   v
                      Server loads manifests   Widget UI renders
                                |
                                v
                      Chat intent prompt uses server manifest list
```

Key design: **Server-side manifest source of truth**.

---

## Data Model

### Table: installed_widgets
Stores widget metadata and manifest for server-side chat usage.

Fields:
- id (uuid, pk)
- user_id (uuid, nullable for single-user mode)
- name (text)
- slug (text, unique per user)
- source_type (enum: url, file, store)
- source_ref (text) // URL or file identifier
- version (text)
- manifest (jsonb) // PanelChatManifest
- enabled (boolean)
- created_at, updated_at

### Table: widget_instances
Stores placement of a widget on a dashboard.

Fields:
- id (uuid, pk)
- user_id (uuid, nullable)
- widget_id (fk -> installed_widgets.id)
- entry_id (uuid)
- workspace_id (uuid) // dashboard workspace
- panel_id (text) // unique instance panelId for chat
- config (jsonb)
- created_at, updated_at

Notes:
- panel_id must be unique per instance, e.g. "taskboard-<instanceId>".
- manifest stored in installed_widgets is the server source of truth.

---

## Chat-Sync Strategy (Server-Visible Manifests)

### Rule
Chat prompt must only use manifests known to the server.

### Mechanism
- On each chat request, server loads all **enabled** widget manifests for the user.
- Server also loads **visible panel IDs** (from request context) and filters manifests accordingly.
- Optional cache: cache manifests per user with TTL and invalidate on widget enable/disable.

### Built-in Widgets Strategy (Phase 1)
**Option B:** Built-in widgets (Recent, Quick Links, Demo) remain in code.
Custom widgets are stored in DB. A full migration of built-ins to DB is a future option.

### Why this avoids the Demo Widget failure
- Server reads manifests from DB, not client runtime state.
- Client registration is only for visibility/focus hints, not for manifest discovery.

---

## Widget Manager UI

### Core UI
- Install input: URL/file/store
- Widget list: Enabled toggle, Settings, Uninstall
- Chat commands preview (from manifest examples)

### Example
```
[ Install widget URL ] [ Add ]

My Widgets
- Task Board   Enabled [on]  Chat: "show tasks", "add task"
- Weather      Enabled [on]  Chat: "show weather"
- Analytics    Disabled      Chat: --
```

---

## Install Pipeline

### Validation Steps
1. Fetch widget package (URL/file/store)
2. Extract manifest (JSON)
3. Validate manifest using validateManifest()
4. Reject if invalid or missing required fields
5. Save to installed_widgets

### Manifest Requirements
- Valid PanelChatManifest
- Intent handlers must be API-only (api:/api/panels/...)
- Permission must be read/write only

---

## Runtime Flow

### 1. User installs widget
- Stored in installed_widgets
- Enabled = true

### 2. User adds widget to dashboard
- Creates widget_instances row
- Generates unique panel_id

### 3. Chat request
- Server loads enabled widget manifests
- Filters to visible panel IDs
- Injects into prompt section

### 4. Chat intent execution
- LLM returns panel_intent
- Server executes API handler

---

## Security / Isolation Model

### Phase 1 (Safe, Server-Only)
- Widgets are data-driven (no arbitrary code execution)
- Only API handlers run on server
- UI rendered by known widget templates

### Phase 2 (Sandboxed Custom Code)
- Allow custom widget bundles
- Render inside iframe/worker sandbox
- Strict allowlist for APIs

---

## Phased Implementation

### Phase 1: DB + Manager UI (Read-Only)
- Add installed_widgets + widget_instances tables
- Basic Widget Manager panel (list + enable/disable)
- Server loads manifests from DB and injects into prompt
- No custom code execution

Phase 1 checklist:
- [ ] DB schema created (installed_widgets, widget_instances)
- [ ] Manager UI lists widgets and enabled state
- [ ] Server loads enabled manifests from DB per request
- [ ] Built-ins remain code-registered (Option B)

### Phase 2: Install Pipeline
- URL/file import
- Manifest validation
- Store manifest + metadata
- Create widget instance

Phase 2 checklist:
- [ ] Install endpoint accepts URL/file
- [ ] Manifest validation enforced
- [ ] Widgets persisted in DB
- [ ] Widget instances created on add

### Phase 3: Safe Custom Widgets
- Sandbox execution
- Permission gating
- Package signing (optional)

Phase 3 checklist:
- [ ] Sandbox for third-party code
- [ ] Restricted API surface
- [ ] Permission gating for write intents

### Phase 4: Widget Store
- Curated list
- Versioning + updates

Phase 4 checklist:
- [ ] Store browsing UI
- [ ] Install from curated list
- [ ] Update flows for installed widgets

---

## Debug Logging (Recommended)
Log these events when debug enabled:
- widget_install_success / widget_install_fail
- widget_manifest_loaded
- widget_chat_prompt_injected
- widget_intent_routed

---

## Files to Touch (Expected)

- migrations/058_create_installed_widgets.up.sql
- migrations/058_create_installed_widgets.down.sql
- app/api/widgets/install/route.ts
- app/api/widgets/list/route.ts
- app/api/widgets/enable/route.ts
- lib/widgets/widget-store.ts (DB access)
- lib/panels/panel-registry.ts (load manifests from DB)
- components/dashboard/widgets/WidgetManager.tsx

---

## Cache Invalidation Rules
- Invalidate manifest cache on: install, uninstall, enable, disable
- TTL: 5 minutes (configurable)
- Cache key: `user_id + widget_manifests`

---

## API Contract Stubs

POST `/api/widgets/install`
- Body: `{ url?: string, file?: string }`
- Response: `{ widget: InstalledWidget }`

GET `/api/widgets/list`
- Response: `{ widgets: InstalledWidget[] }`

POST `/api/widgets/enable`
- Body: `{ id: string, enabled: boolean }`
- Response: `{ success: true }`

DELETE `/api/widgets/:id`
- Response: `{ success: true }`

---

## Success Criteria
- A widget installed via URL shows up in Manager.
- When enabled and visible, its intents appear in the LLM prompt.
- Chat commands map to its manifest without code changes.
- No client-only registration required for server prompt.

---

## Risks
- Serverless cold start: manifest load must be per-request or cached safely.
- Untrusted code: avoid in Phase 1; use sandbox in Phase 3.
- Prompt bloat: filter by visible panels and enabled widgets only.





Here’s a practical manual test checklist for Phase 3.1 (sandbox infra). Each step
  includes what you should see.

  Manual Tests (Phase 3.1)

  1. Install a sandboxed widget

  - Use Widget Manager → install a manifest that includes sandbox.entrypoint (HTTPS) +
    sandbox.permissions.
  - Expect: widget shows in “Custom Widgets” list with enabled toggle.

  2. Add widget to dashboard

  - Click “Add to Dashboard”.
  - Expect: a new widget instance appears on the dashboard.

  3. Open the widget

  - Double‑click the widget to open the drawer (or open it via chat if wired).
  - Expect: iframe loads; widget UI renders. If entrypoint fails, you should see the
    “Widget Error” overlay.

  4. Sandbox wrapper loads

  - In devtools Network, check /api/widgets/sandbox?widgetId=…&channelId=….
  - Expect: response has CSP header; no entrypoint URL in query string.

  5. Channel isolation (two instances)

  - Add the same widget twice, open both.
  - Trigger a visible action from one (e.g., ready log or UI update).
  - Expect: only that widget reacts; the other stays unchanged.

  6. Permission prompt (if widget requests write)

  - Use a widget that calls a write method (e.g., workspace.openPanel).
  - Expect: permission dialog appears with Allow/Deny options.

  7. Network allowlist

  - If widget tries to fetch outside its allowlist, it should fail.
  - Expect: fetch errors (blocked by CSP), no data loaded.

  Expected limitations (by design)

  - “Always allow” grants are not persisted yet (Phase 3.3).
  - If entrypoint is not HTTPS or manifest missing sandbox config, sandbox endpoint returns
    400.


  If you want, send the manifest/entrypoint you’re testing and I’ll tailor the checklist to
  your exact widget.****