# Test Cases - Dynamic Typo Suggestions

## Test Matrix

### Primary Test Cases (from Plan)

| # | Input | Expected Label | Expected Score | Actual Score | Status |
|---|-------|----------------|----------------|--------------|--------|
| 1 | "vuew demo widgets" | Demo Widget | ≥0.90 | 0.950 | ✅ PASS |
| 2 | "oopen recent" | Recent | ≥0.90 | 0.950 | ✅ PASS |
| 3 | "shwo quick links d" | Quick Links D | ≥0.90 | 0.950 | ✅ PASS |
| 4 | "wrkspaces" | Workspaces | ≥0.90 | 0.950 | ✅ PASS |

### Extended Test Cases

| # | Input | Expected Label | Notes |
|---|-------|----------------|-------|
| 5 | "pls vuew demo widgets" | Demo Widget | With prefix "pls" |
| 6 | "oopen recent"" | Recent | With trailing quote |
| 7 | "demo widget" | Demo Widget | Exact match |
| 8 | "quick links" | Quick Links | Generic (no badge) |
| 9 | "links d" | Quick Links D | Shortened form |

### Edge Cases

| # | Input | Expected Behavior | Status |
|---|-------|-------------------|--------|
| 10 | "" | No suggestion | N/A |
| 11 | "xyzabc" | Low confidence fallback | Expected |
| 12 | "recent" | Exact match (score 1.0) | ✅ |
| 13 | "RECENT" | Case-insensitive match | ✅ |

## Fuzzy Matching Verification

### Test Script Output

```
=== Fuzzy Matching Verification ===

Input: "vuew demo widgets"
Normalized: "vuew demo widget"
  vs "demo widget": raw=0.647, normalized=0.688, best=0.688
  vs "view demo widget": raw=0.950, normalized=0.950, best=0.950
  vs "show demo widget": raw=0.765, normalized=0.813, best=0.813
  => Best match: "view demo widget" with score 0.950
  => Passes threshold (0.6)? YES ✓

Input: "oopen recent"
Normalized: "oopen recent"
  vs "recent": raw=0.500, normalized=0.500, best=0.500
  vs "open recent": raw=0.950, normalized=0.950, best=0.950
  => Best match: "open recent" with score 0.950
  => Passes threshold (0.6)? YES ✓

Input: "shwo quick links d"
Normalized: "shwo quick links d"
  vs "quick links d": raw=0.722, normalized=0.722, best=0.722
  vs "show quick links d": raw=0.950, normalized=0.950, best=0.950
  => Best match: "show quick links d" with score 0.950
  => Passes threshold (0.6)? YES ✓

Input: "wrkspaces"
Normalized: "wrkspaces"
  vs "workspaces": raw=0.950, normalized=0.950, best=0.950
  vs "workspace": raw=0.928, normalized=0.928, best=0.928
  => Best match: "workspaces" with score 0.950
  => Passes threshold (0.6)? YES ✓
```

## UI Test Results

### Screenshot 1: Demo Widget

**Input:** "oopen demo widgets"

**Response:**
```
Did you mean **Demo Widget**? I can open it or list it here.

┌─────────────────────────────────────┐
│ Q Demo Widget                       │
│   ✏ Learn TypeScript                │
│   ✏ Build a widget                  │
│   ✏ Test chat integration           │
│   ...and 1 more                     │
│   > Show all 4 items                │
└─────────────────────────────────────┘

[Open Demo Widget >] [List in chat >]
```

**Status:** ✅ PASS - High confidence match with content preview

### Screenshot 2: Recent and Quick Links D

**Input 1:** "oopen recent""

**Response:**
```
Did you mean **Recent**? I can open it or list it here.
[Open Recent >] [List in chat >]
```

**Status:** ✅ PASS

**Input 2:** "oopen recent"

**Response:**
```
Did you mean **Recent**? I can open it or list it here.
[Open Recent >] [List in chat >]
```

**Status:** ✅ PASS

**Input 3:** "shwo quick links d"

**Response:**
```
Did you mean **Quick Links D**? I can open it or list it here.
[Open Quick Links D >] [List in chat >]
```

**Status:** ✅ PASS - Correctly identifies badge variant

## Regression Tests

### Existing Functionality

| Feature | Test | Status |
|---------|------|--------|
| Exact command match | "recent" | ✅ Works |
| Workspaces command | "workspaces" | ✅ Works |
| Dashboard navigation | "dashboard" | ✅ Works |
| Home navigation | "home" | ✅ Works |

### Button Behavior

| Test | Status |
|------|--------|
| "Open X" button opens panel drawer | ✅ |
| "List in chat" shows preview | ✅ |
| Button text visible in dark mode | ✅ |
| Hover state changes color | ✅ |

## Test Execution

### Manual Test Steps

1. Start dev server: `npm run dev`
2. Open chat panel
3. Type each test input
4. Verify response matches expected
5. Click buttons to verify actions

### Automated Test (Future)

```typescript
// Suggested test file: __tests__/typo-suggestions.test.ts
describe('getSuggestions', () => {
  const mockContext = {
    manifests: [demoWidgetManifest],
    visiblePanels: ['quick-links-d', 'recent'],
  }

  it('matches "vuew demo widgets" to Demo Widget', () => {
    const result = getSuggestions('vuew demo widgets', mockContext)
    expect(result?.candidates[0].label).toBe('Demo Widget')
    expect(result?.candidates[0].score).toBeGreaterThanOrEqual(0.90)
  })

  it('matches "oopen recent" to Recent', () => {
    const result = getSuggestions('oopen recent', mockContext)
    expect(result?.candidates[0].label).toBe('Recent')
  })

  it('matches "shwo quick links d" to Quick Links D', () => {
    const result = getSuggestions('shwo quick links d', mockContext)
    expect(result?.candidates[0].label).toBe('Quick Links D')
  })
})
```

## Confidence Thresholds

| Threshold | Behavior |
|-----------|----------|
| ≥0.90 | High confidence - "Did you mean **X**?" with dual buttons |
| 0.60-0.89 | Medium confidence - Single confirmation |
| <0.60 | Low confidence - Generic suggestion list |
| <0.50 | Not included in candidates |
