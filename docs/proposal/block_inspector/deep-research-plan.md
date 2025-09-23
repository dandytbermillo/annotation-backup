# Block Inspector flushSync Warning – Research Plan

## Background
- Recent refactor keeps the floating block inspector interactive, but React still logs:
  - `flushSync was called from inside a lifecycle method. React cannot flush when React is already rendering. Consider moving this call to a scheduler task or micro task.`
  - Latest stack trace points at `lib/extensions/collapsible-block.tsx:1274` when `<EditorContent editor={inspectorEditor} />` renders inside the inspector portal.
- The warning appears only when annotated content exists inside the inspected block. Non-annotated blocks render without issues.
- Inspector currently renders a TipTap `EditorContent` inside a React portal, attaches annotation mark support, and relies on `useEditor` (TipTap React v3) with `immediatelyRender: false`.

## Persisting Symptoms
- Console error surfaces every time the inspector opens for a block containing annotation marks.
- Despite the warning, inspector UI remains functional; however, we need a stable fix to prevent regressions and guarantee compatibility with React concurrent features.

## Current Implementation Touchpoints
- `lib/extensions/collapsible-block.tsx`
  - Creates the inspector editor via `useEditor`.
  - Mounts `<EditorContent>` inside a portal (`createPortal`).
  - Adds annotation mark extension for read-only rendering.
- TipTap dependencies: `@tiptap/react`, `@tiptap/core`, `@tiptap/starter-kit`, custom CollapsibleBlock extension.

## Research Questions
1. **React Lifecycle Interaction**
   - Under what conditions does `useEditor` trigger synchronous React updates that call `flushSync`?
   - Does TipTap internally invoke `flushSync` when the view is re-mounted during render?
2. **Portal Mounting Strategy**
   - Is rendering `<EditorContent>` inside `createPortal` during the same commit causing the warning?
   - Would deferring mount via `useEffect`, `useLayoutEffect`, or custom host container (without React root) eliminate the issue?
3. **Annotation Mark Influence**
   - Does the presence of annotation marks trigger TipTap schema updates that cause synchronous React flushes?
   - Are additional extensions (Highlight, Underline, custom annotation mark) altering initialization order?
4. **React Version Behavior**
   - Verify the project’s React version and known issues regarding `flushSync` warnings (e.g., React 18+ with nested `createRoot` calls or third-party libs).
5. **Alternative Rendering Paths**
   - Evaluate TipTap’s `Editor` view mounting without React `<EditorContent>` (manual ProseMirror view) and its trade-offs.
   - Explore using a memoized readonly HTML renderer instead of TipTap editor for the inspector preview.

## Proposed Research Tasks
1. **Reproduce in Isolation**
   - Build a minimal sandbox (local branch or CodeSandbox) replicating the inspector setup: React portal + TipTap + annotation mark.
   - Confirm warning appears only with annotation marks.
2. **Trace React Update Path**
   - Instrument `EditorContent` lifecycle (e.g., wrap in custom component with `useEffect` logs) to capture when the warning triggers.
   - Use React DevTools Profiler to observe render/commit order when opening inspector.
3. **Review TipTap Source**
   - Inspect `@tiptap/react`’s `EditorContent` implementation to see if it calls `flushSync` (or `editor.view.setProps`) during render.
   - Check release notes / GitHub issues for similar warnings.
4. **Experiment with Mount Strategies**
   - Option A: Mount `<EditorContent>` inside a `useEffect` via `ReactDOM.createRoot` (already attempted—still warned). Refine by using `requestIdleCallback` / `setTimeout` deferral.
   - Option B: Render a read-only HTML snapshot using `DOMSerializer` (skip TipTap entirely) to validate if warning disappears.
   - Option C: Keep TipTap but initialize inspector editor outside React (use `editor.create()` manually) and attach via `useEffect`.
5. **Annotation Schema Audit**
   - Confirm the inspector annotation mark matches production schema; mismatched attributes may cause re-renders.
   - Verify annotation decoration plugins are not expected (they’re absent in inspector—document rationale).
6. **React Docs & Community Search**
   - Search React 18/19 discussions about TipTap + portals causing `flushSync` warnings.
   - Identify recommended patterns for embedding TipTap in portals or modals.

## Deliverables
- **Findings Report** (`docs/proposal/block_inspector/research-findings.md`): summary of experiments, root cause analysis, and recommended remediation options.
- **Proof-of-Concept Fix (optional)**: If a viable solution emerges (e.g., HTML renderer fallback, delayed mount technique), provide prototype or patch preview under `codex/` for review.
- **Open Questions**: Document any remaining edge cases (annotations with collaboration metadata, nested portals, etc.).

## Timeline & Dependencies
- Estimated effort: 1–2 days of focused investigation (excluding implementation).
- Dependencies: Access to local dev environment, ability to modify inspector code, React DevTools for profiling, TipTap source reference.
- Risks: TipTap internals may require upstream changes; fallback HTML rendering might not match interactive requirements (collapse toggles, nested NodeViews).

---
Prepared: 2025-09-23
