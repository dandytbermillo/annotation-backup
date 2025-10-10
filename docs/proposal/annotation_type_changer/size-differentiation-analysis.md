# Size Differentiation Analysis - Should Annotation Types Have Different Sizes?

**Date:** October 9, 2025
**Question:** Should Note panels be smaller than Explore/Promote panels?
**Status:** Analysis & Recommendation

---

## Current State

**All panels are identical size:**
- Width: `500px` (fixed)
- Height: Dynamic based on content
- User can manually resize (if resize feature exists)

---

## Semantic Analysis of Annotation Types

Let me analyze what each type typically represents:

### 📝 Note
**Purpose:** Quick thoughts, references, short annotations

**Typical content:**
- "Important point"
- "Remember to check this"
- "Definition: X means Y"
- Short quotes or excerpts

**Typical length:** 1-3 sentences

**Suggested size:** **Smaller** (350-400px wide)

---

### 🔍 Explore
**Purpose:** Investigation, research questions, analysis

**Typical content:**
- "Why does X happen? Need to research..."
- "Comparing approach A vs B"
- Multiple paragraphs of exploration
- Lists of questions or findings

**Typical length:** 3-10 sentences or lists

**Suggested size:** **Medium** (current 500px is good)

---

### ⭐ Promote
**Purpose:** Key insights, important conclusions, highlights

**Typical content:**
- "Main finding: X leads to Y because Z"
- Important summaries
- Key takeaways
- Synthesized conclusions

**Typical length:** Variable (could be short insight or detailed conclusion)

**Suggested size:** **Medium-Large** (500-600px wide)

---

## Pros & Cons Analysis

### Option A: Different Default Sizes (Type-Based)

**Implementation:**
```typescript
const DEFAULT_WIDTHS = {
  note: 380,      // Smaller
  explore: 500,   // Medium
  promote: 600    // Larger
}

width: `${DEFAULT_WIDTHS[currentBranch.type] || 500}px`
```

**Pros:**
- ✅ Visual hierarchy matches semantic importance
- ✅ Notes take less canvas space (more room for other panels)
- ✅ Promotes stand out as important
- ✅ Reinforces the type system
- ✅ Efficient use of canvas space

**Cons:**
- ⚠️ User might have long notes or short promotes (content doesn't always match type)
- ⚠️ Forcing sizes could be frustrating if user wants different
- ⚠️ Resizing after type change could be jarring
- ⚠️ Complicates layout (different widths harder to organize)
- ⚠️ Might not match user's mental model

---

### Option B: Same Size for All (Current)

**Pros:**
- ✅ Consistent, predictable layout
- ✅ Easy to organize panels in grid
- ✅ No surprises when changing type
- ✅ Content determines size, not type
- ✅ Simpler to implement and maintain

**Cons:**
- ⚠️ Notes might waste space with large panel
- ⚠️ No visual size hierarchy
- ⚠️ Less semantic reinforcement

---

### Option C: Smart Defaults + User Override (Recommended) ⭐

**Implementation:**
```typescript
// Default sizes by type
const DEFAULT_WIDTH_BY_TYPE = {
  note: 380,
  explore: 500,
  promote: 550
}

// On panel creation
const initialWidth = DEFAULT_WIDTH_BY_TYPE[branch.type] || 500

// Store in panel state
const [panelWidth, setPanelWidth] = useState(initialWidth)

// On type change - ASK USER if they want to resize
const handleTypeChange = async (newType) => {
  // ... change type logic ...

  const suggestedWidth = DEFAULT_WIDTH_BY_TYPE[newType]
  if (suggestedWidth !== panelWidth) {
    // Option 1: Ask user
    const resize = confirm(`Resize panel to recommended ${suggestedWidth}px for ${newType} type?`)
    if (resize) setPanelWidth(suggestedWidth)

    // OR Option 2: Auto-resize with undo toast
    setPanelWidth(suggestedWidth)
    showToast('Panel resized. Click to undo.', () => setPanelWidth(panelWidth))
  }
}
```

**Pros:**
- ✅ Best of both worlds
- ✅ Smart defaults for new panels
- ✅ User can override/customize
- ✅ Gentle guidance without forcing
- ✅ Optional auto-resize on type change

**Cons:**
- ⚠️ More complex implementation
- ⚠️ Need resize UI/controls
- ⚠️ Need to store width preference per panel

---

## User Research Insights

**Question to consider:**
> "Do users think of annotation types as having inherent size?"

**Scenarios:**

1. **User creates a Note** → Expects: Small, quick reference
2. **User creates an Explore** → Expects: Room to write/investigate
3. **User creates a Promote** → Expects: Prominent, important

**Most users likely expect:**
- Notes to be "sticky note" sized (small)
- Explores to be "notepad" sized (medium)
- Promotes to be "document" sized (medium-large)

**BUT:** This varies by domain and user workflow!

---

## Recommendation: **Option C with Defaults Only**

### Phase 1: Different Default Sizes (Immediate)

**Implement default sizes but no auto-resize on type change:**

```typescript
// When creating NEW panel
const getDefaultPanelWidth = (type: AnnotationType): number => {
  switch(type) {
    case 'note': return 380      // Compact
    case 'explore': return 500   // Standard
    case 'promote': return 550   // Prominent
    default: return 500
  }
}

// On panel creation (in annotation.ts or wherever panels are created)
const initialWidth = getDefaultPanelWidth(branch.type)
```

**Behavior:**
- ✅ New Note → 380px wide
- ✅ New Explore → 500px wide
- ✅ New Promote → 550px wide
- ✅ Changing type → Keep current size (no forced resize)
- ✅ User can manually resize any panel (if resize exists)

**Benefits:**
- Simple to implement (5 minutes)
- No disruption to existing panels
- Gentle guidance for new users
- No forced behavior

---

### Phase 2: Optional Auto-Resize on Type Change (Future)

**If users request it, add:**
```typescript
// Settings option
const [autoResizeOnTypeChange, setAutoResizeOnTypeChange] = useState(true)

// In handleTypeChange
if (autoResizeOnTypeChange) {
  const newWidth = getDefaultPanelWidth(newType)
  animateWidthChange(panelWidth, newWidth) // Smooth transition
}
```

**With:**
- Toggle in settings: "Auto-resize panels when changing type"
- Smooth animation (not jarring jump)
- Undo button in toast notification

---

## Specific Size Recommendations

Based on typical content:

| Type | Width | Height | Rationale |
|------|-------|--------|-----------|
| **Note** | 380px | Auto | Small sticky-note feel |
| **Explore** | 500px | Auto | Room for investigation |
| **Promote** | 550px | Auto | Prominent important findings |
| **Main** | 600px | Auto | Primary document (keep larger) |

**Height:** Always auto-expand based on content (don't restrict)

---

## Alternative: Content-Based Sizing

**Instead of type-based, use content length:**

```typescript
const getSmartWidth = (content: string, type: AnnotationType) => {
  const charCount = content.length

  if (charCount < 100) return 380   // Short
  if (charCount < 300) return 500   // Medium
  return 600                        // Long
}
```

**Pros:**
- ✅ Matches actual content size
- ✅ No assumptions based on type

**Cons:**
- ⚠️ Content changes → size changes (could be jarring)
- ⚠️ Type loses semantic meaning

**Verdict:** Not recommended. Type-based is clearer.

---

## Implementation Code (Phase 1)

### 1. Create size helper in `lib/models/annotation.ts`:

```typescript
export function getDefaultPanelWidth(type: 'note' | 'explore' | 'promote' | 'main'): number {
  switch(type) {
    case 'note': return 380
    case 'explore': return 500
    case 'promote': return 550
    case 'main': return 600
    default: return 500
  }
}
```

### 2. Update panel creation in `components/canvas/annotation-canvas-modern.tsx`:

```typescript
// When creating new branch panel
const defaultWidth = getDefaultPanelWidth(branch.type)

// Pass to panel component
<CanvasPanel
  panelId={panel.id}
  branch={panel.branch}
  position={panel.position}
  width={defaultWidth}  // Add this prop
  noteId={noteId}
/>
```

### 3. Update `canvas-panel.tsx` to accept width prop:

```typescript
interface CanvasPanelProps {
  panelId: string
  branch: Branch
  position: { x: number; y: number }
  width?: number  // Add optional width prop
  onClose?: () => void
  noteId?: string
}

export function CanvasPanel({
  panelId,
  branch,
  position,
  width = 500,  // Default to 500 if not provided
  onClose,
  noteId
}: CanvasPanelProps) {

  // Use the width prop instead of hardcoded 500px
  style={{
    // ...
    width: `${width}px`,  // Instead of '500px'
    // ...
  }}
}
```

**Estimated effort:** 15 minutes

---

## User Testing Questions

After implementing default sizes:

1. Do smaller Note panels feel right?
2. Does size help you distinguish panel types?
3. Would you want panels to resize when you change type?
4. Are the sizes too different or not different enough?
5. Should any sizes be adjusted?

---

## Final Recommendation

**YES, implement different default sizes:**

| Recommendation | Rationale |
|----------------|-----------|
| **Notes: 380px** | Smaller for quick references |
| **Explores: 500px** | Medium for investigation (current default) |
| **Promotes: 550px** | Slightly larger for importance |
| **Main: 600px** | Keep main panel largest |

**Implementation approach:**
1. ✅ **Phase 1:** Different defaults for NEW panels only (implement now)
2. ⏳ **Phase 2:** Optional auto-resize on type change (wait for user feedback)
3. ⏳ **Phase 3:** Manual resize UI (if users request it)

**Benefits:**
- Reinforces type semantics
- Better use of canvas space
- Visual hierarchy matches importance
- Not forced - just smart defaults

**Minimal risk:**
- Existing panels unchanged
- Only affects new creations
- Easy to adjust if users don't like it

---

## Should I Implement This?

I can implement Phase 1 right now:
- Add `getDefaultPanelWidth()` helper
- Update panel creation to use type-based widths
- Test with all three types

**Estimated time:** 15 minutes

**Would you like me to proceed?**
