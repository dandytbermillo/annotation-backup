# Implementation Plan: Notification Center (Local-First)

**Date:** 2025-12-18
**Status:** Implemented (V1), with recommended V1.1 improvements
**Feature Slug:** `notification-center`

---

## Problem Statement

Today, important workspace/system events are surfaced mostly as transient toasts (save failures, degraded
mode gates, eviction blocks, offline/online transitions). Toasts are easy to miss and leave no durable
audit trail for what happened and why.

The original draft proposed persisting notifications to the server database. That makes the notification
system fail exactly when it is most needed (offline, server down, DB down, auth issues), and it adds new
server routes/migrations to a problem that can be solved client-side first.

---

## Goals

- **Never lose the message:** Notifications persist across reloads.
- **Useful history:** Users can review what happened (with timestamps and details).
- **Actionable:** Provide suggested actions and deep-links (e.g., go to workspace).
- **Low coupling:** Producers can emit notifications without UI dependencies (no “toast from hook”
  anti-pattern).
- **Offline-first:** Works when the network/DB is unavailable.

---

## Non-Goals (V1)

- Cross-device notification sync.
- Server-side delivery, multi-user routing, or push notifications.
- Replacing all toasts; V1 can coexist with existing toasts.

---

## Related References

- `docs/proposal/workspace-state-machine/improvement/2025-12-15-hard-safe-4cap-eviction.md`
- `docs/proposal/workspace-state-machine/improvement/2025-12-16-degraded-mode-ui-reset-plan.md`
- `docs/proposal/workspace-state-machine/offline-durable-queue/IMPLEMENTATION_PLAN.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-17-revision-recovery-on-entry-switch.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-18-prune-transient-mismatch-fix.md`

---

## Guiding Principles

1. **Local-first durability:** Store notifications in the browser (IndexedDB), not the server.
2. **Latest-wins dedupe:** Repeated events should aggregate (count + lastSeenAt) instead of flooding.
3. **Retention limits:** Keep bounded history per entry (age + count caps).
4. **Separate concerns:** Producers emit events; the UI renders them.
5. **Safe payloads:** Store only serializable, non-sensitive details.

---

## V1 Architecture (Local-First)

### Data Flow

1. A subsystem detects an event (e.g., persist failed, eviction blocked, degraded mode entered).
2. It emits a `NotificationEvent` to the notification center.
3. The notification center:
   - Normalizes and validates the event
   - Dedupe/aggregates if applicable
   - Persists to IndexedDB
   - Updates in-memory state for UI subscribers
4. UI shows:
   - A bell badge with unread count
   - A panel listing notifications (filterable, expandable)

### Storage

- **Primary (V1):** IndexedDB (durable across reloads, works offline).
- **In-memory:** For fast render + subscriptions; rehydrated from IndexedDB on app start.

### Storage Adapter Abstraction (Current + Recommended)

V1 already uses a storage adapter, which keeps the system portable. This enables:

- Use SQLite in Electron (main process) via IPC without changing UI/store APIs.
- Add optional server sync (V2) without changing producer callsites.

Current design notes:

- **Atomic upsert in one transaction:** The adapter performs dedupe inside a single IndexedDB transaction.
- **Non-unique dedupe index:** The compound index for `(entryId, dedupeKey)` is non-unique; the adapter
  defends by selecting a non-dismissed match if multiple exist.
- **Retention today:** Pruning runs on store initialize and entry switch (not necessarily after every emit).

Recommended V1.1 improvements:

- **Uniqueness invariant:** Make `(entryId, dedupeKey)` unique to prevent duplicates under concurrency
  (and add a one-time cleanup/merge for any existing duplicates).
- **Upsert + prune batching:** Add an adapter primitive (e.g., `upsertAndPrune(...)` or `writeBatch(...)`)
  so dedupe + retention can be guaranteed in a single atomic write.

---

## Data Model (V1)

### Notification (stored)

- `id`: string (uuid)
- `entryId`: string (required)
- `workspaceId`: string | null
- `severity`: `error | warning | info | success`
- `category`: `workspace | persistence | eviction | offline | system` (extensible)
- `title`: string
- `description`: string | null
- `details`: object (JSON-serializable, optional)
- `dedupeKey`: string | null (if set, enables aggregation)
- `count`: number (default 1; increments on dedupe)
- `createdAt`: ISO string
- `lastSeenAt`: ISO string (updated on dedupe)
- `readAt`: ISO string | null
- `dismissedAt`: ISO string | null

### Dedupe Rules

Use `dedupeKey` for events that can repeat:

- Example patterns:
  - `entry:{entryId}:persist_failed:ws:{workspaceId}`
  - `entry:{entryId}:degraded_mode_entered`

On dedupe hit:
- Increment `count`
- Update `lastSeenAt`
- If previously read, keep `readAt` (do not force unread unless we explicitly decide otherwise)

Dedupe should be implemented with an **entry-scoped uniqueness invariant**:

- If `dedupeKey` is set, treat `(entryId, dedupeKey)` as unique and update the existing record.
- If not set, always insert a new notification.

Note: V1 works without strict uniqueness by resolving duplicates defensively at read/upsert time, but
adding uniqueness is the cleanest way to prevent duplicates under multi-tab or concurrent emit scenarios.

---

## UI Specification (V1)

### Bell + Badge

- Visible in the toolbar (top-right).
- Badge shows unread count (0 hides).
- Click opens a panel dropdown.

### Panel

- Tabs/filters: `All`, `Errors`, `Warnings`, `Info`, `Success`.
- Each item shows:
  - Icon + severity color
  - Title, description
  - Timestamp (createdAt / lastSeenAt)
  - Unread indicator
  - Optional `count` pill for deduped items
- Expand details:
  - Structured key-value view for `details`
  - Actions:
    - Mark read/unread
    - Dismiss
    - Clear all (with confirmation)
    - “Go to workspace” when `workspaceId` exists

### Relationship to Existing UX

- Keep current critical UX (e.g., degraded-mode banner) as the immediate guardrail.
- Also emit a durable notification when:
  - Degraded mode becomes true
  - A persist failure blocks eviction
  - Recovery occurs (optional)

---

## File/Module Placement (avoid naming collisions)

The repo already has other “notification” concepts. Use a distinct namespace:

- `components/notification-center/*`
- `lib/notification-center/*`
- `hooks/use-notification-center.ts`

---

## Implementation Phases

### Phase 1 — Core Store + IndexedDB

- Define `NotificationEvent` and stored `Notification` shape.
- Implement a storage adapter (IndexedDB) with transactional upsert + dedupe.
- Implement a notification store with:
  - `emit(event)`
  - `markRead(id)`
  - `dismiss(id)`
  - `clearAll(entryId, options?)`
  - `subscribe(listener)` for UI
- Implement IndexedDB persistence:
  - Rehydrate store on app start
  - Persist updates on write
- Add retention:
  - Cap total notifications per entry (e.g., 200)
  - Remove dismissed older than N days (e.g., 30)

**Acceptance:**
- Reload preserves notifications and unread count.
- Dedupe produces `count` increments instead of duplicates.
- Dedupe remains correct under rapid repeats in a single session (no user-visible duplicates).

### Phase 2 — UI (Bell + Panel)

- Add bell badge to the main toolbar (visible on all relevant pages).
- Add dropdown panel with list + filters + details view.
- Add actions (mark read, dismiss, clear).

**Acceptance:**
- User can see history and details after reload.
- Unread count updates correctly.

### Phase 3 — Integrations (Producers)

Emit notifications from these sources (minimum set):

- **Hard-safe eviction**
  - Persist failed on dirty workspace (blocked)
  - Degraded mode entered
- **Persistence**
  - Revision mismatch / save precondition failure
  - “Persist repaired” signals (optional; may be too noisy)
- **Offline durable queue (future)**
  - Queue growing / flush succeeded / flush failed (optional)

**Acceptance:**
- When an eviction is blocked, a durable notification appears with workspace context.

### Phase 4 (Optional, V2) — Server Sync

Only after V1 proves stable:

- Add a background sync path that can upload notifications to the server when online.
- Keep local-first as source of truth; server is a replica for multi-device history.
- Guard behind a feature flag and make it safe to disable with no data loss.

**Acceptance:**
- V1 behavior remains correct with sync disabled.

---

## Testing Plan (V1)

- Unit tests:
  - Dedupe behavior (count + lastSeenAt)
  - Retention pruning
  - Read/dismiss transitions
- Manual tests:
  - Trigger blocked eviction while offline → notification appears and persists after reload
  - Enter degraded mode → notification appears and persists
  - Clear all + reload → empty state persists

---

## Risks & Mitigations

- **Over-notification / noise:** Start with a minimal set of producer events; dedupe aggressively.
- **PII leakage:** Limit `details` to IDs and non-sensitive codes; never store raw user content.
- **Performance:** Keep retention bounded; lazy-load details panel if needed.
- **Multi-tab concurrency:** With a non-unique dedupe index, concurrent emits can theoretically create
  duplicates; mitigate with a `(entryId, dedupeKey)` uniqueness invariant in V1.1.

---

## Open Questions

- Should a deduped notification become "unread" again when it reoccurs after being read?
- Should the notification center unify with existing toast infrastructure or remain parallel in V1?

---

## Implementation Summary (2025-12-18)

### Files Created

**Core Library (`lib/notification-center/`)**
- `types.ts` — TypeScript types for notifications, storage adapter, store
- `indexeddb-adapter.ts` — IndexedDB storage adapter with atomic upsert, dedupe, retention
- `notification-store.ts` — Main store with emit/markRead/dismiss/subscribe
- `workspace-integration.ts` — Connects eviction/degraded mode events to notification center
- `index.ts` — Public API exports

**UI Components (`components/notification-center/`)**
- `notification-bell.tsx` — Bell button with unread badge, opens popover
- `notification-panel.tsx` — Panel with filters (All/Errors/Warnings/Info/Success), list, actions
- `notification-item.tsx` — Individual notification with severity icon, timestamp, expandable details
- `index.ts` — Component exports

**Hook (`lib/hooks/`)**
- `use-notification-center.ts` — React hook using `useSyncExternalStore` for reactive updates

### Integration Points

**App Shell (`components/annotation-app-shell.tsx`)**
- Added `NotificationBell` component to top-right toolbar
- Added effect to initialize notification store on entry change
- Added effect to register workspace notification listeners
- Added effect to emit degraded mode notification on transition

**Workspace Integration**
- `registerWorkspaceNotificationListeners()` — Hooks into `registerEvictionBlockedCallback`
- Automatically emits notifications for:
  - Eviction blocked (persist failed)
  - All workspaces busy
  - Degraded mode entered

### Key Features Implemented

1. **IndexedDB Storage**
   - Persists across reloads
   - Works offline
   - Entry-scoped (each entry has its own notifications)

2. **Atomic Upsert with Dedupe**
   - Same `dedupeKey` increments count instead of creating duplicates
   - Updates `lastSeenAt` on re-occurrence

3. **Retention Policy**
   - Max 200 notifications per entry
   - Dismissed notifications pruned after 30 days
   - All notifications pruned after 90 days

4. **UI**
   - Bell with unread badge (top-right)
   - Dropdown panel with severity filters
   - Expandable details for each notification
   - Mark read, dismiss, clear all actions

5. **Producer Integration**
   - Eviction blocked → error notification
   - All workspaces busy → warning notification
   - Degraded mode entered → error notification

### Acceptance Criteria Status

- [x] Reload preserves notifications and unread count
- [x] Dedupe produces `count` increments (no user-visible duplicates in normal usage)
- [x] User can see history and details after reload
- [x] Unread count updates correctly
- [x] When an eviction is blocked, a durable notification appears with workspace context

### What's Not Implemented (Phase 4 / V2)

- Server sync for cross-device history
- "Go to workspace" deep-link action
- Recovery notifications (optional, may be noisy)
- Offline durable queue notifications (depends on queue feature)
