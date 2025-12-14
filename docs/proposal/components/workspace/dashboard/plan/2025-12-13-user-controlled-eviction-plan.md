# User-Controlled Eviction Plan

**Date:** 2025-12-13
**Status:** Planning
**Priority:** High
**Related:**
- `2025-12-13-workspace-eviction-restoration-architecture.md`
- `2025-12-13-long-term-workspace-restore-hot-classification-persistence-gating-component-sync.patch`
- `eviction_limit/IMPLEMENTATION_PLAN.md`

---

## Core Principle

> **If the user started it, it's important. Don't stop it without their permission.**

The system should NEVER automatically evict a workspace with active/running components. Only the user can decide what gets paused.

---

## Problem Statement

### Current Behavior

When memory cap is reached:
1. System picks a workspace to evict (LRU or scoring)
2. Workspace is evicted regardless of what's running
3. User's active operations are stopped without consent

### Desired Behavior

When memory cap is reached:
1. System checks for inactive workspaces first
2. Only inactive workspaces are auto-evicted
3. If ALL workspaces have active components → ask user
4. User decides what can be paused

---

## The Rules

| Rule | Description |
|------|-------------|
| **1. Never auto-evict active** | If component is running, protect it |
| **2. Evict inactive first** | Empty or stopped workspaces go first |
| **3. Ask user if must evict active** | User decides what can be paused |
| **4. User has final control** | System doesn't decide what's "less important" |

---

## Eviction Decision Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    EVICTION TRIGGERED                       │
│                 (memory cap reached)                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│         Step 1: Find INACTIVE workspaces                    │
│         (no running components)                             │
└─────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
         FOUND INACTIVE            ALL ACTIVE
              │                         │
              ▼                         ▼
┌─────────────────────┐    ┌─────────────────────────────────┐
│ Evict inactive      │    │ Step 2: ASK USER                │
│ (safe - nothing     │    │ "All workspaces have running    │
│  running)           │    │  operations. Which can pause?"  │
└─────────────────────┘    └─────────────────────────────────┘
                                        │
                           ┌────────────┴────────────┐
                           │                         │
                      USER SELECTS             USER CANCELS
                           │                         │
                           ▼                         ▼
              ┌─────────────────────┐    ┌─────────────────────┐
              │ Evict selected      │    │ Block new workspace │
              │ workspace           │    │ creation            │
              └─────────────────────┘    └─────────────────────┘
```

---

## Active Component Detection

### What Counts as "Active"?

| Component | Active When | isActive |
|-----------|-------------|----------|
| Timer | `isRunning === true` | `true` |
| Stopwatch | `isRunning === true` | `true` |
| Alarm | `isSet === true && !triggered` | `true` |
| Calculator | Always static | `false` |
| Sticky Note | Always static | `false` |
| Media Player | `isPlaying === true` | `true` |
| Progress Task | `inProgress === true` | `true` |

### Runtime Manager Tracking

```typescript
// Each component registers its active state
useComponentRegistration({
  workspaceId,
  componentId,
  componentType: 'timer',
  position,
  metadata: componentState,
  isActive: isRunning,  // ← Key field
})
```

---

## Implementation

### 1. Check for Active Components

```typescript
// lib/workspace/runtime-manager.ts

/**
 * Check if workspace has any active (running) components.
 */
export function hasActiveComponents(workspaceId: string): boolean {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return false

  for (const component of runtime.components.values()) {
    if (component.isActive) return true
  }
  return false
}

/**
 * Get list of workspaces with no active components.
 * These are safe to evict without user consent.
 */
export function getInactiveWorkspaces(): string[] {
  const inactive: string[] = []

  for (const [workspaceId, runtime] of runtimes.entries()) {
    // Skip pinned
    if (isPinned(workspaceId)) continue
    // Skip currently visible
    if (runtime.isVisible) continue
    // Skip if has active components
    if (hasActiveComponents(workspaceId)) continue

    inactive.push(workspaceId)
  }

  return inactive
}

/**
 * Get list of workspaces with active components.
 * These require user consent to evict.
 */
export function getActiveWorkspaces(): string[] {
  const active: string[] = []

  for (const [workspaceId, runtime] of runtimes.entries()) {
    if (isPinned(workspaceId)) continue
    if (runtime.isVisible) continue
    if (hasActiveComponents(workspaceId)) {
      active.push(workspaceId)
    }
  }

  return active
}
```

### 2. Safe Eviction Selection

```typescript
/**
 * Get workspace to evict safely (without user consent).
 * Returns null if all workspaces have active components.
 */
export function getSafeWorkspaceToEvict(): string | null {
  const inactive = getInactiveWorkspaces()

  if (inactive.length === 0) {
    // All workspaces have active components
    // Cannot auto-evict - need user decision
    return null
  }

  // Sort by recency (oldest first)
  inactive.sort((a, b) => {
    const aTime = runtimes.get(a)?.lastVisibleAt ?? 0
    const bTime = runtimes.get(b)?.lastVisibleAt ?? 0
    return aTime - bTime
  })

  return inactive[0]
}
```

### 3. Eviction Handler with User Prompt

```typescript
// lib/workspace/eviction-handler.ts

export type EvictionResult =
  | { status: 'evicted', workspaceId: string }
  | { status: 'user_prompt_needed', activeWorkspaces: ActiveWorkspaceInfo[] }
  | { status: 'blocked', reason: string }

export interface ActiveWorkspaceInfo {
  workspaceId: string
  name: string
  activeComponents: {
    type: string
    description: string  // e.g., "Timer running at 5:30"
  }[]
}

/**
 * Handle eviction when memory cap reached.
 */
export async function handleEviction(): Promise<EvictionResult> {
  // Try safe eviction first
  const safeToEvict = getSafeWorkspaceToEvict()

  if (safeToEvict) {
    await evictWorkspace(safeToEvict)
    return { status: 'evicted', workspaceId: safeToEvict }
  }

  // All workspaces have active components
  const activeWorkspaces = getActiveWorkspaces().map(wsId => ({
    workspaceId: wsId,
    name: getWorkspaceName(wsId),
    activeComponents: getActiveComponentsInfo(wsId),
  }))

  return {
    status: 'user_prompt_needed',
    activeWorkspaces,
  }
}

/**
 * Get human-readable info about active components.
 */
function getActiveComponentsInfo(workspaceId: string): { type: string, description: string }[] {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return []

  const info: { type: string, description: string }[] = []

  for (const component of runtime.components.values()) {
    if (!component.isActive) continue

    const description = formatActiveComponentDescription(component)
    info.push({
      type: component.componentType,
      description,
    })
  }

  return info
}

/**
 * Format component description for user.
 */
function formatActiveComponentDescription(component: RuntimeComponent): string {
  const { componentType, metadata } = component

  switch (componentType) {
    case 'timer':
      const mins = metadata?.minutes ?? 0
      const secs = metadata?.seconds ?? 0
      return `Timer running at ${mins}:${String(secs).padStart(2, '0')}`

    case 'alarm':
      return `Alarm set for ${metadata?.time ?? 'unknown'}`

    default:
      return `${componentType} is active`
  }
}
```

### 4. User Prompt UI

```typescript
// components/workspace/eviction-prompt-dialog.tsx

interface EvictionPromptDialogProps {
  open: boolean
  activeWorkspaces: ActiveWorkspaceInfo[]
  onSelect: (workspaceId: string) => void
  onCancel: () => void
}

export function EvictionPromptDialog({
  open,
  activeWorkspaces,
  onSelect,
  onCancel,
}: EvictionPromptDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Memory Full</DialogTitle>
          <DialogDescription>
            All workspaces have running operations.
            Select one to pause, or cancel to keep everything running.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {activeWorkspaces.map((ws) => (
            <button
              key={ws.workspaceId}
              onClick={() => onSelect(ws.workspaceId)}
              className="w-full p-3 border rounded hover:bg-gray-50"
            >
              <div className="font-medium">{ws.name}</div>
              <div className="text-sm text-gray-500">
                {ws.activeComponents.map(c => c.description).join(', ')}
              </div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel (Don't open new workspace)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### 5. Integration with Workspace Creation

```typescript
// lib/hooks/annotation/use-note-workspaces.ts

async function switchToWorkspace(workspaceId: string) {
  // Check if we need to evict
  if (isAtMemoryCapacity()) {
    const result = await handleEviction()

    switch (result.status) {
      case 'evicted':
        // Successfully evicted inactive workspace
        // Continue with switch
        break

      case 'user_prompt_needed':
        // Show dialog and wait for user decision
        const userChoice = await showEvictionPrompt(result.activeWorkspaces)

        if (userChoice === null) {
          // User cancelled - don't switch
          toast.info('Workspace switch cancelled', {
            description: 'Close a workspace manually to free up memory.',
          })
          return
        }

        // Evict user's selection
        await evictWorkspace(userChoice)
        break

      case 'blocked':
        toast.error('Cannot open workspace', {
          description: result.reason,
        })
        return
    }
  }

  // Proceed with workspace switch
  // ...
}
```

---

## User Experience

### Scenario 1: Inactive Workspace Exists

```
User: Opens new workspace
System: Memory cap reached
System: Finds inactive workspace (no running components)
System: Evicts inactive workspace silently
Result: New workspace opens, user sees nothing
```

### Scenario 2: All Workspaces Active

```
User: Opens new workspace
System: Memory cap reached
System: All workspaces have running components
System: Shows dialog "Which workspace can be paused?"
User: Selects "Workspace B - Timer running at 5:30"
System: Evicts Workspace B (state saved to DB)
Result: New workspace opens, user made the decision
```

### Scenario 3: User Cancels

```
User: Opens new workspace
System: Memory cap reached
System: Shows dialog
User: Clicks "Cancel"
System: Does NOT evict anything
Result: New workspace doesn't open, all timers keep running
```

---

## Benefits

| Benefit | Description |
|---------|-------------|
| **Respects user intent** | User started it = User decides when to stop |
| **Transparent** | User knows what's happening |
| **No surprises** | Active operations never silently stopped |
| **User control** | User can choose what's less important |
| **Safe fallback** | If user cancels, nothing is lost |

---

## Implementation Tasks

### Phase 1: Active Component Tracking
- [ ] Ensure all components pass `isActive` to useComponentRegistration
- [ ] Implement `hasActiveComponents(workspaceId)`
- [ ] Implement `getInactiveWorkspaces()`
- [ ] Implement `getActiveWorkspaces()`

### Phase 2: Safe Eviction Logic
- [ ] Implement `getSafeWorkspaceToEvict()`
- [ ] Update eviction to only auto-evict inactive workspaces
- [ ] Return null when all workspaces are active

### Phase 3: User Prompt
- [ ] Create `EvictionPromptDialog` component
- [ ] Implement `getActiveComponentsInfo()` for user-friendly descriptions
- [ ] Implement `handleEviction()` with user prompt flow

### Phase 4: Integration
- [ ] Integrate with workspace switch logic
- [ ] Handle user selection
- [ ] Handle user cancellation
- [ ] Add toast notifications

### Phase 5: Testing
- [ ] Test: Inactive workspace evicted silently
- [ ] Test: Dialog shown when all active
- [ ] Test: User selection works
- [ ] Test: Cancellation blocks new workspace
- [ ] Test: Active component descriptions are accurate

---

## Relationship to Existing Plans

| Document | Relationship |
|----------|-------------|
| `IMPLEMENTATION_PLAN.md` Phase 1 | Foundation - state persistence enables safe eviction |
| `IMPLEMENTATION_PLAN.md` Phase 2 | Smart eviction scoring - this plan replaces/extends it |
| `2025-12-13-workspace-eviction-restoration-architecture.md` | Architecture - this plan adds user control layer |
| Current patch | Prerequisite - persistence must work first |

---

## Summary

**Before:** System decides what to evict
**After:** User decides what to evict (for active workspaces)

The system only makes decisions when it's safe (nothing running). When active operations are involved, the user has final control.
