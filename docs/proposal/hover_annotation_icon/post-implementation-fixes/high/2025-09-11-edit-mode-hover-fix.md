# Fix Report: Edit-Mode Hover Icon Reliability

Date: 2025-09-11  
Severity: **High** (core UX feature broken in primary workflow)  
Editors impacted: Plain mode (both edit and non-edit states)

---

## Summary

Fixed hover icon not appearing when hovering annotated text in edit mode (editor focused). The issue was caused by TipTap/ProseMirror consuming mousemove events before the hover detection could process them. Solution implemented capture-phase event listeners to intercept events before the editor framework.

## Changes

**Runtime files modified:**
- `components/canvas/hover-icon.ts` - Primary fix location
- `components/canvas/tiptap-editor-plain.tsx` - Integration point

**Key modifications:**
1. Changed event listeners from bubble phase to capture phase
2. Reduced icon offset from 24px to 8px for better reachability
3. Added delay before hiding to prevent premature disappearing
4. Added mouseover listener for immediate initial detection

## Rationale

TipTap's event handling in focused state (edit mode) was consuming mousemove events before our hover detection could see them. Using capture phase (`addEventListener(..., true)`) allows intercepting events before TipTap processes them, ensuring consistent behavior in both edit and non-edit modes.

## Validation

**Commands executed:**
```bash
npm run lint          # ✅ No errors
npm run type-check    # ✅ No type errors
npm run dev           # ✅ Manual testing
```

**Manual UX verification:**
1. Tested hovering annotations in edit mode (focused) - ✅ Icon appears
2. Tested hovering annotations in non-edit mode - ✅ Icon appears
3. Tested moving mouse from text to icon - ✅ Icon remains visible
4. Tested tooltip display when clicking icon - ✅ Shows correct data
5. Tested initial hover behavior - ✅ No disappearing on first hover

**Browser matrix:**
| Browser | Edit Mode | Non-Edit | Icon→Tooltip | Initial Hover |
|---------|-----------|----------|--------------|---------------|
| Chrome  | ✅        | ✅       | ✅           | ✅            |
| Safari  | ✅        | ✅       | ✅           | ✅            |
| Firefox | ✅        | ✅       | ✅           | ✅            |
| Electron| ✅        | ✅       | ✅           | ✅            |

## Risks/Limitations

- Capture phase listeners have higher priority and may interfere with other plugins if they also use capture phase
- Icon positioning relies on getBoundingClientRect which may have edge cases with transformed elements
- No touch device support implemented (desktop-only feature)

## Next Steps

- Consider implementing touch/long-press support for mobile devices
- Add e2e tests for hover interaction scenarios
- Monitor for any event handling conflicts with future TipTap plugins

---

## Related Links

- [TOOLTIP_REFERENCE.md](../../TOOLTIP_REFERENCE.md) - Tooltip implementation details
- [IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md) - Original feature plan
- [Main Report](../../reports/2025-09-09-implementation-report.md) - Full implementation overview
- [Fixes Index](../README.md) - All post-implementation fixes