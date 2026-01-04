# Widget Manager Implementation Report

**Date:** 2026-01-03
**Status:** Phase 1 + Phase 2 + Phase 2.5 + Phase 3.1 + Phase 3.2 Complete
**Reference:** widget-manager-plan.md, PHASE_3_SANDBOX_PLAN.md, PHASE_3_2_HANDLER_WIRING_PLAN.md

---

## Summary

Implemented a Widget Manager system that allows users to install widgets via URL or file upload and automatically enables chat integration. Server-side manifest source of truth ensures LLM always has access to widget intents.

---

## Phase 1: DB + Manager UI (Read-Only)

### Files Created/Modified

#### Migrations
- `migrations/059_create_widget_manager_tables.up.sql` - Creates `installed_widgets` and `widget_instances` tables
- `migrations/059_create_widget_manager_tables.down.sql` - Rollback migration

#### API Routes
- `app/api/widgets/list/route.ts` - GET endpoint to list installed widgets
- `app/api/widgets/enable/route.ts` - POST endpoint to enable/disable widgets

#### Widget Store (Server-Side DB Access)
- `lib/widgets/widget-store.ts` - Core DB operations:
  - `listInstalledWidgets()` - List widgets for user
  - `getInstalledWidget()` - Get single widget by ID
  - `setWidgetEnabled()` - Toggle enabled state
  - `getEnabledManifests()` - Get manifests for chat prompt injection
  - `invalidateWidgetCache()` - Cache invalidation

#### Panel Registry (Server-Side Manifest Loading)
- `lib/panels/panel-registry.ts` - Modified to load DB manifests:
  - `loadDBManifestLoader()` - Dynamic import of widget-store (server-only)
  - `loadDBManifests()` - Load enabled manifests from DB with pruning
  - `buildPromptSectionWithDB()` - Main entry point for chat requests
  - Added `dbManifestIds` Set for tracking/pruning disabled widgets

#### UI Component
- `components/dashboard/widgets/WidgetManager.tsx` - Widget Manager panel:
  - Lists all installed widgets (builtin + custom)
  - Enable/disable toggle per widget
  - Chat commands preview from manifest examples

### Phase 1 Checklist (All Complete)
- [x] DB schema created (installed_widgets, widget_instances)
- [x] Migration SQL written (059_create_widget_manager_tables)
- [x] Minimal API endpoints (GET /api/widgets/list, POST /api/widgets/enable)
- [x] Manager UI lists widgets and enabled state (WidgetManager.tsx)
- [x] Server loads enabled manifests from DB per request (buildPromptSectionWithDB)
- [x] Built-ins remain code-registered (Option B)

---

## Phase 2: Install Pipeline

### Files Created/Modified

#### Install Pipeline (widget-store.ts additions)
- `lib/widgets/widget-store.ts` - Added install types and functions:
  ```typescript
  // Types
  export type InstallErrorCode = 'FETCH_FAILED' | 'INVALID_JSON' | 'INVALID_MANIFEST' | 'DUPLICATE_SLUG' | 'DB_ERROR'
  export interface InstallError { code: InstallErrorCode; message: string; field?: string }
  export type InstallResult = { success: true; widget: InstalledWidget } | { success: false; error: InstallError }

  // Functions
  installWidgetFromUrl(url, userId) - Fetch, validate, store widget from URL
  uninstallWidget(widgetId, userId) - Remove widget from DB
  createWidgetInstance(widgetId, userId, options) - Add widget to dashboard
  deleteWidgetInstance(instanceId, userId) - Remove widget from dashboard
  ```

#### Manifest Validation
- `lib/panels/panel-manifest.ts` - Added API-only handler validation:
  ```typescript
  // Lines 177-181: Enforce api: prefix
  if (!intent.handler.startsWith('api:')) {
    console.warn(`[PanelManifest] Invalid handler format: ${intent.handler}. Must start with "api:"`)
    return false
  }
  ```

#### API Routes
- `app/api/widgets/install/route.ts` - POST endpoint for URL install:
  - Accepts `{ url: string }`
  - Returns structured errors with codes (502, 422, 409, 500)

- `app/api/widgets/uninstall/route.ts` - POST endpoint for uninstall:
  - Accepts `{ id: string }`

- `app/api/widgets/instances/route.ts` - Widget instances CRUD:
  - POST: Add widget to dashboard (creates instance)
  - DELETE: Remove widget from dashboard
  - GET: List instances for workspace

- `app/api/widgets/sample-manifest/route.ts` - Test manifest endpoint:
  - Returns valid PanelChatManifest for testing install flow

#### UI Enhancements (WidgetManager.tsx)
- Install from URL form with validation
- "Add to Dashboard" button (LayoutDashboard icon)
- Uninstall button for custom widgets
- Refresh button
- Sample manifest helper link

### Phase 2 Checklist (All Complete)
- [x] Install endpoint accepts URL
- [x] Manifest validation enforced (including api: handler prefix)
- [x] Widgets persisted in DB
- [x] Widget instances created on add-to-dashboard (UI wiring)

---

## Phase 2 Hardening

### Tests Created

#### Unit Tests: Panel Manifest Validation
- `__tests__/unit/widgets/panel-manifest.test.ts` - 29 tests:
  - Valid manifest acceptance (4 tests)
  - Invalid input rejection (3 tests)
  - Missing required fields (8 tests)
  - Version validation (2 tests)
  - Intent validation (5 tests)
  - API-only handler validation (4 tests)
  - Empty intents array (1 test)

```bash
# Run tests
npm test -- __tests__/unit/widgets/panel-manifest.test.ts
# Result: 29 passed
```

#### Integration Tests: Widget Store
- `__tests__/integration/widgets/widget-store.test.ts` - 18 tests:
  - listInstalledWidgets (2 tests)
  - getInstalledWidget (2 tests)
  - setWidgetEnabled (3 tests)
  - getEnabledManifests (1 test)
  - installWidgetFromUrl error cases (2 tests)
  - installWidgetFromFile (4 tests) - *Added in Phase 2.5*
  - createWidgetInstance (1 test)
  - listWidgetInstances (1 test)
  - deleteWidgetInstance (2 tests)

```bash
# Run tests (requires DATABASE_URL)
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/annotation_dev' npm test -- __tests__/integration/widgets/widget-store.test.ts
# Result: 18 passed
```

### UI Polish

#### Toast Notifications
- Replaced 3 `alert()` calls with toast notifications:
  - Add to dashboard success/failure
  - Uninstall success/failure
- Uses `useToast` hook from `hooks/use-toast.ts`

#### Inline Confirmation
- Replaced native `confirm()` with inline UI for uninstall:
  - Click trash icon shows "Uninstall? [Yes] [No]" inline
  - Styled buttons (red for confirm, gray for cancel)
  - State managed in WidgetListRow component

---

## Phase 2.5: File Import

### Overview
Added file upload support as an alternative to URL-based widget installation. Users can now drag-and-drop JSON manifest files or use a file picker to install widgets locally.

### Backend Changes

#### widget-store.ts Refactoring
Refactored the install pipeline to share common logic between URL and file installs:

```typescript
// Helper: Validate manifest and provide specific field feedback
function getManifestValidationError(manifestJson: unknown): InstallError | null

// Helper: Install a validated manifest into the database
async function installManifestToDB(
  manifest: PanelChatManifest,
  userId: string | null,
  sourceType: WidgetSourceType,
  sourceRef: string | null
): Promise<InstallResult>

// New function for file-based installation
export async function installWidgetFromFile(
  fileContent: string,
  fileName: string,
  userId: string | null
): Promise<InstallResult>
```

#### New API Endpoint
- `app/api/widgets/install-file/route.ts` - POST endpoint for file upload:
  - Accepts `multipart/form-data` with `file` field
  - Validates `.json` file extension
  - Enforces 100KB max file size
  - Returns structured errors (422 for invalid JSON/manifest, 409 for duplicate)

### Frontend Changes

#### WidgetManager.tsx Updates
- Added `installWidgetFromFile(file)` API function
- Added drag-and-drop handlers:
  - `handleDragOver` - Visual feedback on drag enter
  - `handleDragLeave` - Remove visual feedback
  - `handleDrop` - Process dropped file
- Added `handleFileChange` for file input
- Added `isDragging` state for visual feedback

#### UI Components
- Divider between URL and file sections ("or")
- Drag-drop zone with:
  - Purple dashed border (animated on drag)
  - FileJson icon
  - "Choose file or drag & drop" text
  - Click-to-browse via hidden file input
- Error display for invalid files

### Tests Added

Extended `__tests__/integration/widgets/widget-store.test.ts` with 4 new tests:

```typescript
describe('installWidgetFromFile', () => {
  it('should install a widget from valid JSON content')
  it('should return INVALID_JSON for invalid JSON')
  it('should return INVALID_MANIFEST for missing required fields')
  it('should return DUPLICATE_SLUG for existing widget')
})
```

```bash
# Run file install tests
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/annotation_dev' \
  npm test -- __tests__/integration/widgets/widget-store.test.ts
# Result: 18 passed (14 existing + 4 new)
```

### Phase 2.5 Checklist (All Complete)
- [x] Refactor install pipeline with shared helpers
- [x] Add `installWidgetFromFile()` function
- [x] Create `/api/widgets/install-file` endpoint
- [x] Add drag-and-drop UI to WidgetManager
- [x] Add file picker (click-to-browse) UI
- [x] Integration tests for file install function

---

## Phase 3.1: Sandbox Infrastructure

### Overview
Implemented secure sandbox infrastructure for running third-party widget code in isolated iframes. This enables widgets to execute custom JavaScript while maintaining strict security boundaries through CSP headers, origin validation, and a permission-gated bridge API.

### Security Architecture

#### 1. Iframe Sandbox Attributes
```html
<iframe sandbox="allow-scripts allow-forms" ...>
```
- `allow-scripts` - Execute widget code
- `allow-forms` - Submit forms if needed
- **Omitted**: `allow-same-origin` (isolates widget from host cookies/storage)

#### 2. Content Security Policy (via HTTP Header)
CSP is set via HTTP response header (not iframe attribute) for reliable enforcement:
```
default-src 'none';
script-src 'unsafe-inline' {entrypoint-origin};
style-src 'unsafe-inline';
img-src data: https:;
connect-src {networkAllowlist | 'none'};
frame-ancestors 'self';
```

#### 3. Origin Validation (Both Directions)

**Host validates widget messages:**
```typescript
// SandboxBridge.handleMessage()
const allowedOrigins = new Set([window.location.origin, 'null'])
if (!allowedOrigins.has(event.origin)) return  // reject
if (event.source !== iframe.contentWindow) return  // reject
if (data.channelId !== this.config.channelId) return  // reject
```

**Widget validates host messages:**
```javascript
// Widget SDK (injected into sandbox HTML)
const HOST_ORIGIN = "${hostOrigin}";  // From server, not user input

function handleHostMessage(event) {
  if (event.source !== window.parent) return;
  if (event.origin !== HOST_ORIGIN) return;  // CRITICAL
  if (data.channelId !== CHANNEL_ID) return;
  // ... process message
}
```

#### 4. Channel ID Isolation
Each widget instance gets a unique `channelId` (UUID) to prevent cross-widget message bleed:
```typescript
const [channelId] = useState(() => generateChannelId())  // crypto.randomUUID()
```

### Files Created

#### Migration
- `migrations/060_create_widget_permission_grants.up.sql` - Permission grants table:
  ```sql
  CREATE TABLE widget_permission_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    widget_instance_id UUID NOT NULL REFERENCES widget_instances(id) ON DELETE CASCADE,
    user_id UUID,
    permission TEXT NOT NULL,
    allow_level TEXT NOT NULL CHECK (allow_level IN ('once', 'always', 'never')),
    granted_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(widget_instance_id, user_id, permission)
  );
  ```
- `migrations/060_create_widget_permission_grants.down.sql` - Rollback

#### Sandbox Permissions Module
- `lib/widgets/sandbox-permissions.ts`:
  - `WidgetPermission` type: `'read:workspace' | 'read:notes' | 'write:workspace' | 'write:notes' | 'write:chat' | 'network:fetch'`
  - `PERMISSION_INFO` - Human-readable labels and descriptions
  - `getMethodPermission(method)` - Maps API methods to required permissions
  - `hasPermission(declared, required)` - Check if permission is declared
  - `checkApprovalStatus()` - Combines session + persistent grants
  - Session grant management (`recordSessionGrant`, `getSessionGrant`)

#### Sandbox Wrapper Endpoint
- `app/api/widgets/sandbox/route.ts` - Serves sandboxed widget HTML:
  - Looks up widget from DB by `widgetId` (not entrypoint in URL)
  - Validates HTTPS entrypoint
  - Builds CSP header from `sandbox.networkAllowlist`
  - Injects Widget Bridge SDK with `HOST_ORIGIN` for origin validation
  - Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`

#### Host-Side Bridge
- `lib/widgets/sandbox-bridge.ts`:
  - `SandboxBridge` class - Manages postMessage communication
  - `BridgeHandlers` interface - Typed API method handlers
  - Origin + source + channelId validation
  - Permission checking before handler execution
  - `onPermissionRequest` callback for user approval flow

#### React Component
- `components/widgets/WidgetSandboxHost.tsx`:
  - `WidgetSandboxHost` - Renders sandboxed iframe
  - `PermissionDialog` - User approval UI for permission requests
  - Loading/error state management
  - Bridge lifecycle (init on mount, destroy on unmount)

### Files Modified

#### panel-manifest.ts Updates
- Added `SandboxConfig` interface:
  ```typescript
  interface SandboxConfig {
    entrypoint: string           // HTTPS URL to widget JS bundle
    permissions: WidgetPermission[]
    networkAllowlist?: string[]  // For connect-src CSP
    minSize?: { width: number; height: number }
    preferredSize?: { width: number; height: number }
  }
  ```
- Added `validateSandboxConfig()` function:
  - Validates HTTPS entrypoint URL
  - Validates known permissions only
  - Validates HTTPS network origins in allowlist

### Widget Bridge API

The injected Widget SDK provides these methods to widget code:

```javascript
// Exposed as window.WidgetBridge
WidgetBridge.widgetId      // Widget identifier
WidgetBridge.channelId     // Unique channel for this instance
WidgetBridge.permissions   // Declared permissions array

WidgetBridge.request(method, params)  // Generic API request

// Convenience namespaces
WidgetBridge.workspace.getPanels()
WidgetBridge.workspace.getActivePanel()
WidgetBridge.workspace.openPanel(panelId)
WidgetBridge.workspace.closePanel(panelId)

WidgetBridge.notes.getCurrentNote()
WidgetBridge.notes.getNote(noteId)
WidgetBridge.notes.updateNote(noteId, content)

WidgetBridge.ui.showToast(message, type)
WidgetBridge.ui.requestResize(width, height)

WidgetBridge.storage.get(key)
WidgetBridge.storage.set(key, value)

WidgetBridge.ready()  // Signal widget is ready
```

### Phase 3.1 Checklist (All Complete)
- [x] Migration for `widget_permission_grants` table
- [x] `lib/widgets/sandbox-permissions.ts` - Permission types and checking
- [x] `lib/panels/panel-manifest.ts` - SandboxConfig validation
- [x] `app/api/widgets/sandbox/route.ts` - Wrapper endpoint with CSP header
- [x] `lib/widgets/sandbox-bridge.ts` - Host-side bridge with origin validation
- [x] `components/widgets/WidgetSandboxHost.tsx` - React component with permission dialog
- [x] Widget-side origin validation (HOST_ORIGIN check in SDK)
- [x] Channel ID isolation (crypto-random UUID per instance)

### Phase 3.1 Security Guarantees
1. **Widget isolation**: No access to host cookies, localStorage, or DOM
2. **Origin validation**: Both host and widget validate message origins
3. **Channel isolation**: Cross-widget message bleed prevented via channelId
4. **Permission gating**: Write operations require explicit user approval
5. **Network restriction**: External fetches limited to declared allowlist
6. **CSP enforcement**: Via HTTP header (not bypassable by widget)

---

## Phase 3.2: Handler Wiring (Read-Only)

### Overview
Implemented read-only bridge handlers that allow sandboxed widgets to access workspace and note state. Handlers are pure functions that transform UI state into bridge responses.

### Architecture

```
Widget iframe
  → postMessage request: workspace.getPanels
Host (SandboxBridge)
  → Permission check (read:workspace) → auto-allow
  → Handler executes against host state
  → Response returned to widget
```

### Files Created

#### Bridge API Handlers
- `lib/widgets/bridge-api/workspace.ts` - Workspace handlers:
  - `handleGetPanels(state)` → Returns list of visible panels with id, type, title, isActive
  - `handleGetActivePanel(state)` → Returns the currently active/focused panel

- `lib/widgets/bridge-api/notes.ts` - Notes handlers:
  - `handleGetCurrentNote(state)` → Returns current note with preview (max 500 chars)
  - `handleGetNote(state, { noteId })` → Returns note by ID with preview

- `lib/widgets/bridge-api/index.ts` - Barrel export

#### Handler Hook
- `lib/widgets/use-sandbox-handlers.ts`:
  - `useSandboxHandlers(options)` - Creates `BridgeHandlers` from dependencies
  - `createEmptyDependencies()` - Factory for empty/null-safe state

#### Integration Component
- `components/widgets/SandboxWidgetPanel.tsx`:
  - Wrapper that combines `WidgetSandboxHost` with `useSandboxHandlers`
  - Manages widget resize requests
  - Ready to use in DashboardWidgetRenderer

### Payload Shapes

**workspace.getPanels Response:**
```typescript
{
  panels: [
    { id: string, type: string, title: string | null, isActive: boolean }
  ]
}
```

**notes.getCurrentNote Response:**
```typescript
{
  note: {
    id: string,
    title: string,
    contentPreview: string,  // Max 500 chars
    isTruncated: boolean
  } | null
}
```

### Handler Dependencies

The hook accepts dependencies via props (dependency injection pattern):

```typescript
const handlers = useSandboxHandlers({
  dependencies: {
    workspace: {
      panels: WorkspacePanel[],     // From dashboard state
      activePanelId: string | null, // From dashboard state
    },
    notes: {
      currentNote: { id, title, content } | null,
      getNoteById: async (noteId) => note | null,
    },
  },
  onResizeRequest: (width, height) => void,
})
```

### Phase 3.2 Checklist (All Complete)
- [x] `lib/widgets/bridge-api/workspace.ts` - Workspace read handlers
- [x] `lib/widgets/bridge-api/notes.ts` - Notes read handlers
- [x] `lib/widgets/bridge-api/index.ts` - Barrel export
- [x] `lib/widgets/use-sandbox-handlers.ts` - Handler hook with dependencies
- [x] `components/widgets/SandboxWidgetPanel.tsx` - Integration component
- [x] Type-check passes

### Phase 3.2 Scope Limits (By Design)
- **Read-only**: No write handlers (Phase 3.3)
- **No permission persistence**: "Always Allow" DB wiring (Phase 3.3)
- **No storage handlers**: Widget storage API (Phase 3.3)
- **Content preview only**: Full note content not exposed to reduce risk

---

## All Affected Files Summary

### Created Files
| File | Purpose |
|------|---------|
| `migrations/059_create_widget_manager_tables.up.sql` | DB schema |
| `migrations/059_create_widget_manager_tables.down.sql` | Rollback |
| `migrations/060_create_widget_permission_grants.up.sql` | Permission grants table (Phase 3.1) |
| `migrations/060_create_widget_permission_grants.down.sql` | Rollback (Phase 3.1) |
| `lib/widgets/widget-store.ts` | Server-side DB operations |
| `lib/widgets/sandbox-permissions.ts` | Permission types and checking (Phase 3.1) |
| `lib/widgets/sandbox-bridge.ts` | Host-side postMessage bridge (Phase 3.1) |
| `app/api/widgets/list/route.ts` | List widgets API |
| `app/api/widgets/enable/route.ts` | Enable/disable API |
| `app/api/widgets/install/route.ts` | Install from URL API |
| `app/api/widgets/install-file/route.ts` | Install from file API (Phase 2.5) |
| `app/api/widgets/uninstall/route.ts` | Uninstall API |
| `app/api/widgets/instances/route.ts` | Widget instances CRUD |
| `app/api/widgets/sample-manifest/route.ts` | Test manifest |
| `app/api/widgets/sandbox/route.ts` | Sandbox wrapper with CSP (Phase 3.1) |
| `components/dashboard/widgets/WidgetManager.tsx` | Manager UI |
| `components/widgets/WidgetSandboxHost.tsx` | Sandbox host component (Phase 3.1) |
| `components/widgets/SandboxWidgetPanel.tsx` | Integration wrapper (Phase 3.2) |
| `lib/widgets/bridge-api/workspace.ts` | Workspace read handlers (Phase 3.2) |
| `lib/widgets/bridge-api/notes.ts` | Notes read handlers (Phase 3.2) |
| `lib/widgets/bridge-api/index.ts` | Barrel export (Phase 3.2) |
| `lib/widgets/use-sandbox-handlers.ts` | Handler hook (Phase 3.2) |
| `__tests__/unit/widgets/panel-manifest.test.ts` | Manifest tests (29 tests) |
| `__tests__/integration/widgets/widget-store.test.ts` | Store tests (18 tests) |

### Modified Files
| File | Changes |
|------|---------|
| `lib/panels/panel-manifest.ts` | Added api: handler validation, SandboxConfig interface, validateSandboxConfig() |
| `lib/panels/panel-registry.ts` | Added DB manifest loading, dbManifestIds pruning |
| `lib/db/pool.ts` | Lazy proxy initialization, `closeServerPool()` for test cleanup |

---

## Manual Testing Performed

### Install Flow
```bash
# 1. Install sample widget
curl -X POST "http://localhost:3000/api/widgets/install" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/api/widgets/sample-manifest"}'
# Result: success, widget installed

# 2. Verify in DB
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev \
  -c "SELECT id, name, slug, enabled FROM installed_widgets;"

# 3. Test duplicate slug error
curl -X POST "http://localhost:3000/api/widgets/install" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/api/widgets/sample-manifest"}'
# Result: 409 DUPLICATE_SLUG

# 4. Test unreachable URL
curl -X POST "http://localhost:3000/api/widgets/install" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:99999/nonexistent"}'
# Result: 502 FETCH_FAILED
```

### Widget Instances Flow
```bash
# 1. Add widget to dashboard
curl -X POST "http://localhost:3000/api/widgets/instances" \
  -H "Content-Type: application/json" \
  -d '{"widgetId": "<widget-uuid>"}'
# Result: instance created with auto-generated panel_id

# 2. Verify in DB
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev \
  -c "SELECT id, widget_id, panel_id FROM widget_instances;"

# 3. Delete instance
curl -X DELETE "http://localhost:3000/api/widgets/instances" \
  -H "Content-Type: application/json" \
  -d '{"instanceId": "<instance-uuid>"}'
# Result: success
```

### Chat Integration
```bash
# Test chat recognizes installed widget
curl -X POST "http://localhost:3000/api/chat/navigate" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello sample", "visiblePanelIds": ["sample-widget"]}'
# Result: returns panel_intent with panelId: "sample-widget"
```

### File Upload Flow (Phase 2.5)
```bash
# 1. Create a test manifest file
cat > /tmp/test-widget.json << 'EOF'
{
  "panelId": "file-upload-test",
  "panelType": "tool",
  "title": "File Upload Test Widget",
  "version": "1.0",
  "intents": [
    {
      "name": "test_file_upload",
      "description": "Test intent from file upload",
      "examples": ["test file widget"],
      "handler": "api:/api/test",
      "permission": "read"
    }
  ]
}
EOF

# 2. Install via file upload API
curl -X POST "http://localhost:3000/api/widgets/install-file" \
  -F "file=@/tmp/test-widget.json"
# Result: {"success":true,"message":"Widget \"File Upload Test Widget\" installed from file","widget":{...}}

# 3. Verify in DB
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev \
  -c "SELECT id, name, slug, source_type, source_ref FROM installed_widgets WHERE source_type = 'file';"

# 4. Test invalid file
echo "not valid json" > /tmp/invalid.json
curl -X POST "http://localhost:3000/api/widgets/install-file" \
  -F "file=@/tmp/invalid.json"
# Result: 422 INVALID_JSON
```

---

## Validation Commands

```bash
# Type check
npm run type-check

# Unit tests (no DB required)
npm test -- __tests__/unit/widgets/panel-manifest.test.ts

# Integration tests (requires DB)
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/annotation_dev' \
  npm test -- __tests__/integration/widgets/widget-store.test.ts

# Full test suite
npm test
```

---

## Known Limitations

1. **Permission persistence not wired** - Session grants work, but DB persistence for "Always Allow"/"Always Deny" not yet connected to UI (Phase 3.3).
2. **Single-user mode** - Uses default user ID `00000000-0000-0000-0000-000000000000`.
3. **File size limit** - File uploads limited to 100KB (sufficient for JSON manifests).
4. **Read-only handlers** - Write handlers (workspace.openPanel, notes.updateNote) deferred to Phase 3.3.
5. **No storage API** - Widget-scoped storage deferred to Phase 3.3.
6. **Content preview only** - Notes handlers return 500-char preview, not full content (security).

---

## Next Phases

### Phase 3.3: Write Handlers + Permission Persistence
- [ ] Wire `workspace.openPanel` / `workspace.closePanel` handlers
- [ ] Wire `notes.updateNote` handler
- [ ] Wire `storage.get` / `storage.set` with DB table
- [ ] Wire "Always Allow" to DB insert
- [ ] Wire "Always Deny" to DB insert
- [ ] Load persistent grants on component mount
- [ ] UI to view/revoke granted permissions

### Phase 3.4: Dashboard Integration
- [ ] Add custom widget panel type to DashboardWidgetRenderer
- [ ] Wire dependencies from dashboard state
- [ ] Full E2E test with real sandboxed widget

### Phase 4: Widget Store
- [ ] Store browsing UI
- [ ] Install from curated list
- [ ] Update flows for installed widgets
