# Critical Errors Documentation

This directory contains detailed documentation for critical errors encountered and resolved in the annotation project.

---

## Directory Structure

```
Critical_error/
├── README.md                                     ← This file
├── REACT_SETSTATE_DURING_RENDER_FIX.md          ← React setState violation fix
├── FIX_VERIFICATION_REPORT.md                   ← Accuracy verification of setState fix
├── INFINITE_LOOP_MINIMAP_DRAG_FIX.md            ← Infinite loop during minimap drag fix
└── Maximum update depth exceeded/
    └── FIX_DOCUMENTATION.md                     ← Focused docs for infinite loop error
```

---

## Error Reports

### 1. React setState During Render Error ✅ RESOLVED

**Date:** 2025-10-27
**Severity:** Critical
**Status:** Fixed

**Error:**
```
Cannot update a component (AnnotationAppContent) while rendering
a different component (ForwardRef)
```

**Summary:**
- Parent state update (`setFreshNoteSeeds`) was being called during child's state update (`setCanvasItems`)
- Violated React's rendering rules
- Fixed by deferring parent callback with `queueMicrotask()`

**Files Affected:**
- `components/annotation-canvas-modern.tsx` (Line 732)

**Documentation:**
- [REACT_SETSTATE_DURING_RENDER_FIX.md](./REACT_SETSTATE_DURING_RENDER_FIX.md) - Complete fix documentation
- [FIX_VERIFICATION_REPORT.md](./FIX_VERIFICATION_REPORT.md) - ✅ Verified 100% accurate

---

### 2. Infinite Loop During Minimap Drag ✅ RESOLVED

**Date:** 2025-10-27
**Severity:** Critical
**Status:** Fixed

**Error:**
```
Maximum update depth exceeded. This can happen when a component calls setState
inside useEffect, but useEffect either doesn't have a dependency array, or one
of the dependencies changes on every render.
```

**Summary:**
- `handleNoteHydration` callback included `canvasState.translateX/Y/zoom` in dependencies
- Minimap dragging changed these values constantly
- Caused callback to recreate → useEffect to re-run → infinite loop
- Fixed by using `canvasStateRef` instead of direct state access

**Files Affected:**
- `components/annotation-canvas-modern.tsx` (Lines 950-954, 1118-1120)

**Documentation:**
- [INFINITE_LOOP_MINIMAP_DRAG_FIX.md](./INFINITE_LOOP_MINIMAP_DRAG_FIX.md) - Comprehensive fix documentation with examples
- [Maximum update depth exceeded/FIX_DOCUMENTATION.md](./Maximum%20update%20depth%20exceeded/FIX_DOCUMENTATION.md) - Focused fix documentation

---

## Quick Reference

### How to Use This Directory

1. **When encountering a critical error:**
   - Create new markdown file: `ERROR_NAME_FIX.md`
   - Follow the template structure (see existing files)
   - Include: error message, root cause, fix, verification

2. **Document structure:**
   - Error Summary
   - Root Cause Analysis
   - Technical Details
   - The Fix
   - Verification
   - Prevention Guidelines

3. **Update this README:**
   - Add entry to "Error Reports" section
   - Include status (Resolved/In Progress/Open)
   - Link to detailed documentation

---

## Error Categories

### React Errors
- [x] setState during render (RESOLVED)
- [x] Infinite loop from dependency chain (RESOLVED)

### State Management Errors
- (None documented yet)

### API/Backend Errors
- (None documented yet)

### Performance Issues
- (None documented yet)

---

## Prevention Checklist

When adding new features, check for:

- [ ] No setState calls inside setState updater functions
- [ ] No setState calls inside render methods
- [ ] Callbacks that trigger setState are properly deferred
- [ ] useEffect dependencies are correct
- [ ] No race conditions in async operations
- [ ] Distinguish "read current value" (use ref) vs "react to changes" (use dependency)
- [ ] Avoid frequently-changing values in useCallback dependencies
- [ ] Watch for useEffect chains that depend on unstable callbacks

---

## Related Documentation

- [CLAUDE.md](../../../CLAUDE.md) - Project conventions and error logging
- [INITIAL.md](../../../INITIAL.md) - Feature requirements and error logs
- [codex/how_to/debug_logs.md](../../../codex/how_to/debug_logs.md) - Debug logging guidelines

---

**Last Updated:** 2025-10-27
**Maintained By:** Development Team
