# Widget Manager Implementation Report

**Date:** 2026-01-03
**Status:** Phase 1 + Phase 2 + Phase 2.5 Complete (with Hardening)
**Reference:** widget-manager-plan.md

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

## All Affected Files Summary

### Created Files
| File | Purpose |
|------|---------|
| `migrations/059_create_widget_manager_tables.up.sql` | DB schema |
| `migrations/059_create_widget_manager_tables.down.sql` | Rollback |
| `lib/widgets/widget-store.ts` | Server-side DB operations |
| `app/api/widgets/list/route.ts` | List widgets API |
| `app/api/widgets/enable/route.ts` | Enable/disable API |
| `app/api/widgets/install/route.ts` | Install from URL API |
| `app/api/widgets/install-file/route.ts` | Install from file API (Phase 2.5) |
| `app/api/widgets/uninstall/route.ts` | Uninstall API |
| `app/api/widgets/instances/route.ts` | Widget instances CRUD |
| `app/api/widgets/sample-manifest/route.ts` | Test manifest |
| `components/dashboard/widgets/WidgetManager.tsx` | Manager UI |
| `__tests__/unit/widgets/panel-manifest.test.ts` | Manifest tests (29 tests) |
| `__tests__/integration/widgets/widget-store.test.ts` | Store tests (18 tests) |

### Modified Files
| File | Changes |
|------|---------|
| `lib/panels/panel-manifest.ts` | Added api: handler validation (lines 177-181) |
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

1. **No widget code execution** - Widgets are data-driven (manifests only). Custom code sandboxing is Phase 3.
2. **Single-user mode** - Uses default user ID `00000000-0000-0000-0000-000000000000`.
3. **File size limit** - File uploads limited to 100KB (sufficient for JSON manifests).

---

## Next Phases

### Phase 3: Safe Custom Widgets
- [ ] Sandbox for third-party code (iframe/worker)
- [ ] Restricted API surface
- [ ] Permission gating for write intents

### Phase 4: Widget Store
- [ ] Store browsing UI
- [ ] Install from curated list
- [ ] Update flows for installed widgets
