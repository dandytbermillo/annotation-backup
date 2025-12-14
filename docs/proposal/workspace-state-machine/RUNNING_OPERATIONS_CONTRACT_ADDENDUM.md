# Running Operations Contract Addendum

This addendum clarifies how the workspace system can reliably know whether a component is “running in the
background”, including when components are authored by other developers or users.

It is intended to complement `docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md:912` (store
extensibility) and the “activeIds” concept used for eviction priority and user-controlled eviction.

---

## Definitions

### Durable State

State that should survive switching, eviction, and reload:
- Calculator display values
- Note text
- Timer remaining time
- Media position

Durable state persistence does **not** imply “running”.

### Running Operation

A “running operation” is background behavior that advances over time without further user input, such as:
- Countdown ticking
- Audio playing
- Alarm schedule counting down
- Ongoing upload/download

Running operations influence:
- Eviction priority and whether eviction is allowed automatically
- Whether the system must keep a workspace runtime alive in the background

---

## Why The Workspace Cannot Infer “Running”

For third-party or user-defined components, there is no reliable universal heuristic:
- A component may have internal timers, websockets, or workers that are not visible to the workspace.
- UI state (e.g., a calculator showing “42”) is not an operation.
- Components may intentionally pause work when hidden, or may need to keep running.

So the system should **not guess**.

The only reliable approach is an explicit contract: components declare background operations to the
workspace runtime/store.

---

## The Contract (Conceptual)

Each component type can optionally provide a “runtime integration” contract that answers:

1. **Does this component type support background operations?**
2. **How does the workspace start/stop the operation?**
3. **How does the component indicate “active” vs “inactive”?**
4. **What is durable vs ephemeral for this type (cold restore invariant)?**

This contract is implemented via the component-type registry described in the plan.

---

## How The Workspace Knows What’s Active

### First-party components

For built-in components (Timer, Media, Alarm):
- The workspace store/runtime owns the operation (Option B).
- “Active” is tracked by the workspace because it created the operation and can stop it.
- The UI component becomes a view/controller for starting and stopping.

### Third-party/user-defined components

There are two safe modes:

#### Mode 1: Integrated (recommended)

The component type ships an integration adapter registered with the workspace:
- The adapter exposes start/stop hooks for operations (if any).
- The adapter tells the workspace when the component is active.
- The workspace hosts the operation and updates durable state.

This makes “running” visible and enforceable at the workspace level.

#### Mode 2: Non-integrated (safe fallback)

If a component type does not provide an adapter:
- The workspace treats it as **not running** by default (no active protection).
- The workspace still persists its durable state.
- The UI can expose a user override:
  - “Keep this workspace alive in background” (pin/workspace protect)
  - Or “This workspace has background activity” (manual mark, optional)

This avoids silent resource leaks and avoids guessing.

---

## Eviction Policy Implications (User-Controlled)

To match the goal “running workspaces stay alive across entry switches”:
- Workspaces with active operations should be protected from automatic eviction.
- When capacity is exceeded, the system should prompt for an explicit decision:
  - Stop background operations in a chosen workspace (making it evictable), or
  - Pin/protect specific workspaces, or
  - Increase capacity limits (if supported), or
  - Cancel the attempted action that would exceed capacity.

For non-integrated component types, the safest default is:
- Do not treat them as active automatically
- Allow the user to mark the workspace as protected if they know it must keep running

---

## Scenarios

### Scenario A: Calculator “42”

- User types “42” and switches away.
- This is durable state, not a running operation.
- The workspace may be evicted if needed (after persistence), and “42” must restore on return.

### Scenario B: Timer ticking

- User starts a timer and switches to another workspace or another entry.
- The timer operation remains active in the workspace runtime/store.
- When the user returns later, the UI mounts and renders the updated durable timer state.

### Scenario C: Third-party “Music Player”

Two outcomes:
- If integrated: playback is a declared running operation; workspace protects it; eviction requires user
  decision.
- If not integrated: workspace treats it as not-running; user can pin/protect the workspace to keep it
  alive, or accept that playback will stop on eviction/reload.

---

## Recommended Product/UX Defaults

- Keep the contract optional, not required, but strongly recommended for components with background work.
- Provide a simple UI affordance at the workspace level:
  - “Protected (kept alive)” and “Allow eviction”
- When the system cannot evict due to protected active operations, surface a clear prompt rather than
  silently stopping work.

