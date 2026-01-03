# Phase 3: Safe Custom Widgets - Design Plan

**Date:** 2026-01-03
**Status:** Draft
**Prerequisite:** Phase 1 + Phase 2 + Phase 2.5 Complete

---

## Overview

Phase 3 enables widgets to include custom executable code (JavaScript/React components) that runs in a secure sandbox. This allows third-party widget developers to create rich, interactive widgets while protecting the host application from malicious code.

---

## Goals

1. **Sandboxed Execution** - Widget code runs in an isolated iframe with restricted capabilities
2. **Controlled Communication** - Host and widget communicate only via a defined bridge API
3. **Permission Model** - Widgets declare required permissions; sensitive operations require user approval
4. **Graceful Degradation** - Widgets without sandbox code continue to work as data-driven manifests

## Non-Goals (v1)

- Server-side widget code execution
- Package signing/verification (deferred to Phase 3.5)
- Widget-to-widget communication
- Offline widget caching

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Host Application (annotation-backup)                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  WidgetSandboxHost                                      ││
│  │  - Creates iframe with sandbox restrictions              ││
│  │  - Manages postMessage bridge                            ││
│  │  - Enforces permission checks                            ││
│  └─────────────────────────────────────────────────────────┘│
│                          │ postMessage                       │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  <iframe sandbox="...">                                 ││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │  Widget Code (untrusted)                            │││
│  │  │  - Loads from manifest.sandbox.entrypoint           │││
│  │  │  - Uses WidgetBridgeClient to communicate           │││
│  │  │  - Renders custom UI                                │││
│  │  └─────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## Sandbox Implementation

### Sandbox Wrapper Endpoint

**Key insight:** The iframe `csp` attribute is not widely supported. CSP must be set via HTTP header on the iframe's content. This requires a server-side wrapper endpoint.

```
GET /api/widgets/sandbox?entrypoint=<url>&widgetId=<id>
```

**Response:** HTML wrapper page with:
1. CSP header set by the server
2. Minimal HTML that loads the widget entrypoint
3. Bridge client SDK injected

```typescript
// app/api/widgets/sandbox/route.ts
export async function GET(request: NextRequest) {
  const entrypoint = request.nextUrl.searchParams.get('entrypoint')
  const widgetId = request.nextUrl.searchParams.get('widgetId')

  // Validate entrypoint URL against allowlist
  if (!isAllowedEntrypoint(entrypoint)) {
    return new Response('Invalid entrypoint', { status: 400 })
  }

  const html = generateSandboxHTML(entrypoint, widgetId)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy': buildCSP(widgetId),
      'X-Frame-Options': 'SAMEORIGIN',
    },
  })
}
```

### iframe Sandbox Attributes

```html
<iframe
  src="/api/widgets/sandbox?entrypoint=...&widgetId=..."
  sandbox="allow-scripts allow-forms"
  referrerpolicy="no-referrer"
/>
```

**Restricted by default:**
- `allow-same-origin` - Widget cannot access host cookies/storage
- `allow-top-navigation` - Widget cannot navigate parent window
- `allow-popups` - Widget cannot open popups
- `allow-modals` - Widget cannot show alert/confirm/prompt

**Allowed:**
- `allow-scripts` - Required for widget code execution
- `allow-forms` - Allow form submission within widget

### Recommended Default Sandbox Flags

**Default (recommended):** `sandbox="allow-scripts allow-forms"`  
- Origin becomes `"null"`; rely on `event.source` + `channelId` checks.
- Strongest isolation; no access to host storage or cookies.

**If a widget runtime requires same-origin (avoid if possible):**  
`sandbox="allow-scripts allow-forms allow-same-origin"`  
- Origin becomes same-origin; must rely on strict origin + source checks.
- Increased risk surface; use only when necessary.

Decision guide:

| Requirement | Recommended Flags | Security Impact |
|------------|-------------------|-----------------|
| No storage access needed | `allow-scripts allow-forms` | Lowest risk |
| Widget needs same-origin (rare) | `allow-scripts allow-forms allow-same-origin` | Higher risk |

### Content Security Policy (via HTTP Header)

The wrapper endpoint sets CSP via response header:

```
Content-Security-Policy:
  default-src 'none';
  script-src 'unsafe-inline' 'unsafe-eval' <entrypoint-origin>;
  style-src 'unsafe-inline';
  img-src data: https:;
  connect-src <network-allowlist>;
  frame-ancestors 'self';
```

**Key restrictions:**
- `script-src` only allows the specific entrypoint origin + inline
- `connect-src` uses per-widget network allowlist (not blanket `https:`)
- `frame-ancestors 'self'` prevents embedding in other sites

### Network Allowlist

Widgets must declare allowed network origins in manifest:

```json
{
  "sandbox": {
    "entrypoint": "https://widgets.example.com/my-widget.js",
    "networkAllowlist": [
      "https://api.example.com",
      "https://cdn.example.com"
    ]
  }
}
```

If `networkAllowlist` is empty or omitted, `connect-src 'none'` is used (no external network access). Widgets can still use the bridge API to proxy requests through the host if needed.

---

## Bridge API

Communication between host and widget via `postMessage`:

### Message Protocol

```typescript
interface BridgeMessage {
  type: 'request' | 'response' | 'event'
  id: string // Unique message ID for request/response correlation
  method?: string // For requests
  params?: unknown // For requests
  result?: unknown // For responses
  error?: { code: string; message: string } // For error responses
}
```

### Origin Validation (Critical Security)

**All postMessage handlers MUST validate `event.origin`, `event.source`, and `channelId`:**

```typescript
// lib/widgets/sandbox-bridge.ts

interface BridgeConfig {
  iframeRef: React.RefObject<HTMLIFrameElement>
  widgetId: string
  channelId: string  // Unique per widget instance to prevent cross-widget bleed
}

function createMessageHandler(config: BridgeConfig) {
  return function handleMessage(event: MessageEvent) {
    // CRITICAL 1: Validate origin
    // If iframe sandbox omits allow-same-origin, event.origin will be "null".
    const allowedOrigins = new Set([window.location.origin, 'null'])
    if (!allowedOrigins.has(event.origin)) {
      console.warn(`[SandboxBridge] Rejected message from unauthorized origin: ${event.origin}`)
      return
    }

    // CRITICAL 2: Validate source is our specific iframe
    if (event.source !== config.iframeRef.current?.contentWindow) {
      console.warn('[SandboxBridge] Rejected message from unknown source')
      return
    }

    // CRITICAL 3: Validate channelId to prevent cross-widget message bleed
    if (event.data?.channelId !== config.channelId) {
      console.warn(`[SandboxBridge] Rejected message with wrong channelId: ${event.data?.channelId}`)
      return
    }

    // Now safe to process message
    processMessage(event.data, config.widgetId)
  }
}
```

**Origin check requirements:**
- Host validates `event.origin` is same-origin (wrapper served from same domain)
- If iframe sandbox omits allow-same-origin, host accepts origin "null" and relies on source + channelId checks
- Host validates `event.source === iframe.contentWindow` (correct iframe)
- Host validates `event.data.channelId` matches per-instance ID (prevent cross-widget bleed)
- Widget validates host messages come from `window.parent` origin
- channelId is a crypto-random UUID generated per widget mount, passed to wrapper via query param

### Host → Widget Events

| Event | Description | Payload |
|-------|-------------|---------|
| `widget:init` | Widget loaded, send config | `{ config, permissions }` |
| `widget:resize` | Container size changed | `{ width, height }` |
| `widget:theme` | Theme changed | `{ theme: 'light' | 'dark' }` |
| `workspace:update` | Workspace state changed | `{ panels, activePanel }` |

### Widget → Host Requests

#### Read APIs (require `read:*` permission)

| Method | Permission | Description |
|--------|------------|-------------|
| `workspace.getPanels` | `read:workspace` | Get visible panels |
| `workspace.getActivePanel` | `read:workspace` | Get active panel ID |
| `notes.getNote` | `read:notes` | Get note by ID |
| `notes.getCurrentNote` | `read:notes` | Get current note content |

#### Write APIs (require `write:*` permission + user approval)

| Method | Permission | Description |
|--------|------------|-------------|
| `workspace.openPanel` | `write:workspace` | Open/focus a panel |
| `workspace.closePanel` | `write:workspace` | Close a panel |
| `notes.updateNote` | `write:notes` | Update note content |
| `chat.sendMessage` | `write:chat` | Send message to chat |

#### Utility APIs (no special permission)

| Method | Description |
|--------|-------------|
| `ui.showToast` | Show toast notification |
| `ui.requestResize` | Request container resize |
| `storage.get` | Get widget-scoped storage |
| `storage.set` | Set widget-scoped storage |

---

## Permission Model

### Permission Types

```typescript
type WidgetPermission =
  | 'read:workspace'   // Read workspace/panel state
  | 'read:notes'       // Read note content
  | 'write:workspace'  // Modify panels (requires approval)
  | 'write:notes'      // Modify notes (requires approval)
  | 'write:chat'       // Send chat messages (requires approval)
  | 'network:fetch'    // Make external HTTP requests
```

### Manifest Declaration

```json
{
  "panelId": "my-custom-widget",
  "title": "My Custom Widget",
  "version": "1.0",
  "sandbox": {
    "entrypoint": "https://example.com/widget.js",
    "permissions": ["read:workspace", "read:notes"]
  },
  "intents": [...]
}
```

### Permission Enforcement

1. **Declaration Check** - Widget can only request permissions declared in manifest
2. **Runtime Check** - Each bridge call checks if widget has required permission
3. **User Approval** - Write permissions show confirmation dialog on first use

### Approval Flow (Write Permissions)

```
Widget calls: notes.updateNote({ noteId, content })
                    │
                    ▼
        ┌─────────────────────────┐
        │ Permission Check        │
        │ Has 'write:notes'?      │
        └─────────────────────────┘
                    │ Yes
                    ▼
        ┌─────────────────────────┐
        │ User Approval Required? │
        │ (first time or always)  │
        └─────────────────────────┘
                    │ Yes
                    ▼
        ┌─────────────────────────┐
        │ Show Confirmation       │
        │ "Widget X wants to      │
        │  modify note Y"         │
        │ [Allow] [Deny] [Always] │
        └─────────────────────────┘
                    │
                    ▼
        Execute or reject based on user choice
```

### Permission Persistence Scope

**Scope: Per widget instance (widget_instances.id)**

Approval decisions are stored per installed widget instance, not per widget type or globally:

| Scope | Description |
|-------|-------------|
| **Widget Instance** | Each installed widget has its own approval state |
| **User** | Approvals are tied to user_id (for multi-user mode) |
| **Persistent** | "Always Allow/Deny" stored in DB, survives restarts |
| **Session** | One-time "Allow/Deny" stored in memory only |

**Database schema addition:**

```sql
-- Add to installed_widgets or create new table
CREATE TABLE widget_permission_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_instance_id UUID NOT NULL REFERENCES widget_instances(id) ON DELETE CASCADE,
  user_id UUID, -- nullable for single-user mode
  permission TEXT NOT NULL,
  allow_level TEXT NOT NULL CHECK (allow_level IN ('once', 'always', 'never')),
  granted_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, -- null = permanent, set for 'once' grants
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(widget_instance_id, user_id, permission)
);

CREATE INDEX idx_widget_permission_grants_widget_instance ON widget_permission_grants(widget_instance_id);
CREATE INDEX idx_widget_permission_grants_user ON widget_permission_grants(user_id);
```

**allow_level values:**
- `once` - Allow this one time, then re-prompt (expires_at set to now + session)
- `always` - Always allow without prompting
- `never` - Always deny without prompting

**Flow:**
1. Widget requests write permission
2. Check `widget_permission_grants` for existing grant (by widget_instance_id)
3. If `always_allow` → execute immediately
4. If `always_deny` → reject immediately
5. Otherwise → show approval dialog
6. If user chooses "Always" → persist to DB

---

## Manifest Schema Changes

### Schema Versioning

The `sandbox` field is **optional** and backward-compatible with version `"1.0"`:

| Version | Sandbox Support | Notes |
|---------|-----------------|-------|
| `"1.0"` | Optional | `sandbox` field ignored if not present |
| `"1.1"` | Optional | Formal sandbox support (future) |

Widgets without `sandbox` continue to work as data-driven manifests (Phase 1-2.5 behavior).

### Extended PanelChatManifest

```typescript
interface PanelChatManifest {
  panelId: string
  panelType: string
  title: string
  version: string  // "1.0" still valid, sandbox is optional
  description?: string
  intents: PanelIntent[]

  // NEW: Phase 3 sandbox configuration (optional)
  sandbox?: {
    /** URL to widget entry point (JS bundle) */
    entrypoint: string

    /** Permissions this widget requires */
    permissions: WidgetPermission[]

    /**
     * Allowed network origins for connect-src CSP directive.
     * If empty/omitted, no external network access allowed.
     */
    networkAllowlist?: string[]

    /** Minimum container size */
    minSize?: { width: number; height: number }

    /** Preferred container size */
    preferredSize?: { width: number; height: number }
  }
}
```

### Validation Updates (panel-manifest.ts)

Add sandbox validation to `validateManifest()`:

```typescript
// If sandbox is present, validate its fields
if (manifest.sandbox) {
  const sandbox = manifest.sandbox

  // entrypoint is required if sandbox is present
  if (!sandbox.entrypoint || typeof sandbox.entrypoint !== 'string') {
    console.warn('[PanelManifest] sandbox.entrypoint is required')
    return false
  }

  // Validate entrypoint is HTTPS URL
  try {
    const url = new URL(sandbox.entrypoint)
    if (url.protocol !== 'https:') {
      console.warn('[PanelManifest] sandbox.entrypoint must be HTTPS')
      return false
    }
  } catch {
    console.warn('[PanelManifest] sandbox.entrypoint must be a valid URL')
    return false
  }

  // Validate permissions array
  if (!Array.isArray(sandbox.permissions)) {
    console.warn('[PanelManifest] sandbox.permissions must be an array')
    return false
  }

  // Validate each permission is known
  const validPermissions = ['read:workspace', 'read:notes', 'write:workspace',
                           'write:notes', 'write:chat', 'network:fetch']
  for (const perm of sandbox.permissions) {
    if (!validPermissions.includes(perm)) {
      console.warn(`[PanelManifest] Unknown permission: ${perm}`)
      return false
    }
  }

  // Validate networkAllowlist if present
  if (sandbox.networkAllowlist) {
    if (!Array.isArray(sandbox.networkAllowlist)) {
      console.warn('[PanelManifest] sandbox.networkAllowlist must be an array')
      return false
    }
    for (const origin of sandbox.networkAllowlist) {
      try {
        const url = new URL(origin)
        if (url.protocol !== 'https:') {
          console.warn(`[PanelManifest] networkAllowlist origin must be HTTPS: ${origin}`)
          return false
        }
      } catch {
        console.warn(`[PanelManifest] Invalid networkAllowlist origin: ${origin}`)
        return false
      }
    }
  }
}
```

### Database Schema

**New table for permission grants:**

```sql
-- migrations/060_create_widget_permission_grants.up.sql
CREATE TABLE widget_permission_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id UUID NOT NULL REFERENCES installed_widgets(id) ON DELETE CASCADE,
  user_id UUID, -- nullable for single-user mode
  permission TEXT NOT NULL,
  allow_level TEXT NOT NULL CHECK (allow_level IN ('once', 'always', 'never')),
  granted_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, -- null = permanent, set for 'once' grants
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(widget_id, user_id, permission)
);

CREATE INDEX idx_widget_permission_grants_widget ON widget_permission_grants(widget_id);
CREATE INDEX idx_widget_permission_grants_user ON widget_permission_grants(user_id);
```

No changes needed to `installed_widgets` - manifest JSONB already stores full manifest including sandbox config.

### CSP Build Rules

**Critical: connect-src must be built from manifest only, never user input:**

```typescript
function buildCSP(manifest: PanelChatManifest): string {
  const networkAllowlist = manifest.sandbox?.networkAllowlist ?? []

  // Default to 'none' if no allowlist
  const connectSrc = networkAllowlist.length > 0
    ? networkAllowlist.join(' ')
    : "'none'"

  return [
    "default-src 'none'",
    // Add 'unsafe-eval' only if the widget runtime requires it
    `script-src 'unsafe-inline'`,
    "style-src 'unsafe-inline'",
    "img-src data: https:",
    // Include 'self' only if widgets are allowed to call host APIs directly
    `connect-src ${connectSrc}`,
    "frame-ancestors 'self'",
  ].join('; ')
}
```

---

## Implementation Plan

### Phase 3.1: Sandbox Infrastructure

**Files to create:**
- `app/api/widgets/sandbox/route.ts` - Wrapper endpoint with CSP headers
- `components/widgets/WidgetSandboxHost.tsx` - Host component that renders iframe
- `lib/widgets/sandbox-bridge.ts` - Bridge message handling (with origin + channelId validation)
- `lib/widgets/sandbox-permissions.ts` - Permission checking
- `migrations/060_create_widget_permission_grants.up.sql` - Permission grants table
- `migrations/060_create_widget_permission_grants.down.sql` - Rollback

**Files to modify:**
- `lib/panels/panel-manifest.ts` - Add sandbox block + networkAllowlist validation

**Deliverables:**
- [ ] Sandbox wrapper endpoint with CSP headers (connect-src from networkAllowlist only, default 'none')
- [ ] WidgetSandboxHost component renders iframe via wrapper with channelId
- [ ] Origin + source + channelId validated postMessage communication
- [ ] Manifest validation accepts sandbox block (optional in version "1.0")
- [ ] Widget can send/receive messages

### Phase 3.2: Bridge API (Read-Only)

**Files to create:**
- `lib/widgets/bridge-api/workspace.ts` - Workspace read methods
- `lib/widgets/bridge-api/notes.ts` - Notes read methods
- `lib/widgets/bridge-api/index.ts` - API registry

**Deliverables:**
- [ ] `workspace.getPanels` implemented
- [ ] `workspace.getActivePanel` implemented
- [ ] `notes.getCurrentNote` implemented
- [ ] Permission checking for read APIs

### Phase 3.3: Permission Gating + Write APIs

**Files to create/modify:**
- `lib/widgets/bridge-api/workspace.ts` - Add write methods
- `lib/widgets/bridge-api/notes.ts` - Add write methods
- `components/widgets/PermissionDialog.tsx` - User approval UI

**Deliverables:**
- [ ] Write API methods implemented
- [ ] User approval dialog for write operations
- [ ] Permission state persisted per widget

### Phase 3.4: Widget SDK (Optional)

**Files to create:**
- `public/widget-sdk.js` - SDK for widget developers
- `docs/widget-development.md` - Developer documentation

**Deliverables:**
- [ ] Widget SDK published
- [ ] Sample sandboxed widget
- [ ] Developer documentation

---

## Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|------------|
| XSS from widget | iframe sandbox prevents DOM access |
| Data exfiltration | CSP restricts network requests |
| Clickjacking | Widget cannot overlay host UI |
| Storage access | No same-origin, no cookies/localStorage |
| Navigation attacks | No top navigation allowed |
| Infinite loops | Browser handles, consider timeout |
| Memory exhaustion | Browser handles per-iframe limits |

### Security Checklist

- [ ] iframe sandbox attribute correctly configured
- [ ] CSP header/meta applied
- [ ] Origin validation on postMessage
- [ ] Permission check on every bridge call
- [ ] User approval for all write operations
- [ ] Rate limiting on bridge calls (optional)

---

## Testing Strategy

### Unit Tests
- Permission checking logic
- Bridge message parsing
- Manifest validation with sandbox fields

### Integration Tests
- Widget loads in iframe
- Bridge communication works
- Permission denied for unauthorized calls
- User approval flow

### Security Tests
- Widget cannot access host DOM
- Widget cannot access host storage
- Widget cannot make unauthorized network requests
- Widget cannot navigate parent window

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `components/widgets/WidgetSandboxHost.tsx` | Iframe host component |
| `components/widgets/PermissionDialog.tsx` | User approval dialog |
| `lib/widgets/sandbox-bridge.ts` | postMessage bridge |
| `lib/widgets/sandbox-permissions.ts` | Permission logic |
| `lib/widgets/bridge-api/index.ts` | API registry |
| `lib/widgets/bridge-api/workspace.ts` | Workspace APIs |
| `lib/widgets/bridge-api/notes.ts` | Notes APIs |
| `lib/widgets/bridge-api/storage.ts` | Widget storage APIs |
| `public/widget-sdk.js` | Widget developer SDK |
| `__tests__/unit/widgets/sandbox-*.test.ts` | Sandbox tests |

### Modified Files
| File | Changes |
|------|---------|
| `lib/panels/panel-manifest.ts` | Add sandbox schema validation |
| `components/dashboard/widgets/WidgetManager.tsx` | Show sandbox permissions |
| `components/dashboard/DashboardWidgetRenderer.tsx` | Render sandbox widgets |

---

## Open Questions

1. **Entrypoint format**: URL only, or also support inline code in manifest?
2. **Widget storage**: How much storage per widget? Use IndexedDB or server-side?
3. **Network access**: Allow `fetch` from widget, or proxy through host?
4. **Hot reload**: Support development mode with live reload?
5. **Error handling**: How to surface widget errors to users?

---

## Success Criteria

Phase 3 is complete when:
- [ ] Widgets with `sandbox` config render in secure iframe
- [ ] Bridge API allows read operations with permission check
- [ ] Write operations require user approval
- [ ] Sample sandboxed widget demonstrates full capability
- [ ] Security tests verify isolation

---

## References

- [MDN: iframe sandbox attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox)
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [MDN: postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [OWASP: Third-party JavaScript Management](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html)
