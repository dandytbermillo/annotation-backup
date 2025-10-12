# LLM Verification Prompt: Cross-Browser Branch Panel Sync Implementation

**Purpose**: Verify the safety, correctness, and production-readiness of the cross-browser sync implementation

---

## Instructions for Reviewing LLM

You are a senior software engineer conducting a critical code review. Your task is to verify whether a cross-browser synchronization implementation is safe for production deployment.

**Review the following:**
1. The problem description
2. The implementation approach
3. The code changes
4. The safety analysis
5. The test results

**Then provide:**
1. Independent safety assessment
2. Identification of any data loss scenarios
3. Verification of the safety analysis claims
4. Production readiness recommendation
5. Any critical issues that must be fixed before deployment

---

## Part 1: Problem Description

### Original Issue

**Symptom:**
- Branch panel content edits in Chrome don't appear in Firefox
- Branch panel content edits in Firefox don't appear in Chrome
- Each browser works in isolation, silently overwriting each other's changes
- User sees error: "Error: stale document save: baseVersion X behind latest Y"
- After error, changes don't sync even after reloading

**Critical Observation:**
- Main panel content DOES sync correctly across browsers
- Branch panel TITLES sync correctly across browsers
- Only branch panel CONTENT fails to sync

**User Impact:**
- Data loss when multiple browsers edit the same branch
- Silent overwrites with no warning
- Frustrating user experience requiring manual coordination

---

## Part 2: Root Cause Analysis

### What Was Discovered

**The Problem:**
Each browser has its own `PlainOfflineProvider` instance with in-memory cache. When a browser loads a branch panel:

1. Provider checks memory cache first
2. If cache exists, returns cached content (doesn't check database)
3. Editor displays cached content
4. User edits based on stale cache
5. Save succeeds (no conflict because baseVersion matches cache)
6. Other browser's changes are silently overwritten

**Why Main Panels Work:**
- Main panels load content from provider BEFORE displaying
- Provider cache is populated on first load
- Subsequent loads use fresh provider cache

**Why Branch Panels Don't Work:**
- Branch panels pre-populate from localStorage snapshots
- Provider cache becomes stale
- No mechanism to check database for remote updates
- Browsers work in isolation

---

## Part 3: Implemented Solution

### Overview

Added a visibility-based refresh mechanism that checks the database for remote changes when a browser tab becomes visible.

### Components

**1. Remote Update Event Listener** (`tiptap-editor-plain.tsx`)
```typescript
// Lines 1203-1268
const handleRemoteUpdate = (event: {
  noteId: string
  panelId: string
  version: number
  content: ProseMirrorJSON | HtmlString
  reason?: string
}) => {
  // Only handle updates for this specific panel
  if (event.noteId !== noteId || event.panelId !== panelId) return

  // Make editor non-editable during update
  const wasEditable = editor.isEditable
  if (wasEditable) editor.setEditable(false)
  if (editor.isFocused) editor.commands.blur()

  // Update content
  editor.chain()
    .clearContent()
    .insertContent(event.content)
    .run()

  // Restore editability
  if (wasEditable) editor.setEditable(true)

  // Update dataStore
  onContentLoaded?.({ content: event.content, version: event.version })
}

provider.on('document:remote-update', handleRemoteUpdate)
```

**2. Visibility-Based Refresh** (`tiptap-editor-plain.tsx`)
```typescript
// Lines 1329-1351
const handleVisibilityChange = async () => {
  if (document.visibilityState === 'hidden') {
    saveCurrentContent(false) // async save
  } else if (document.visibilityState === 'visible' && provider) {
    // Check for remote updates when page becomes visible
    await provider.checkForRemoteUpdates(noteId, panelId)
  }
}
```

**3. Public Refresh Method** (`plain-offline-provider.ts`)
```typescript
// Lines 762-768
async checkForRemoteUpdates(noteId: string, panelId: string): Promise<void> {
  await this.refreshDocumentFromRemote(noteId, panelId, 'manual')
}

// This method:
// - Always fetches from database (bypasses cache)
// - Updates provider cache
// - Emits 'document:remote-update' event
```

**4. localStorage Backup** (`tiptap-editor-plain.tsx`)
```typescript
// Lines 1294-1305
// Always save to localStorage synchronously as backup
const pendingKey = `pending_save_${noteId}_${panelId}`
localStorage.setItem(pendingKey, JSON.stringify({
  content: json,
  timestamp: Date.now(),
  noteId,
  panelId
}))

// Then try database save
if (!isSync) {
  await provider.saveDocument(...)
}
```

---

## Part 4: Safety Analysis Reference

**Document**: `docs/proposal/extensible-annotation-types/reports/SAFETY-ANALYSIS-REVISED.md`

### Key Claims to Verify

**Claim 1: Rapid Tab Switching is SAFE**
- Assertion: localStorage backup prevents data loss
- Evidence: Lines 1294-1305 save to localStorage before database
- Recovery: Lines 385-411 restore from localStorage on next load

**Claim 2: Typing During Conflict is MINOR**
- Assertion: Only 2-5 characters lost in < 2% of edits
- Evidence: 150ms window between auto-save and conflict resolution
- User Experience: Focus loss is noticeable, easy to recover

**Claim 3: No Permanent Data Loss**
- Assertion: localStorage acts as safety net
- Evidence: All content saved to localStorage synchronously
- Recovery: Restored on next page load or visibility change

**Claim 4: 98% Safe for Production**
- Assertion: Implementation is production-ready
- Evidence: Real-world user testing, localStorage backup, conflict detection
- Comparison: Comparable to Google Docs, Notion (they also have edge cases)

---

## Part 5: Test Results from User

### What User Observed

**Working Correctly:**
- ✅ Branch panel content changes reflected successfully across all browsers
- ✅ Branch panel titles sync correctly across all browsers
- ✅ No deletion experienced during normal usage
- ✅ Content updates automatically when switching browsers

**Errors That Appear:**
```
Error: stale document save: baseVersion 3 behind latest 5
```

**But:**
- ✅ Errors appear but sync works correctly
- ✅ Content shows latest version after error
- ✅ No manual refresh needed

### Console Logs from User

**Successful Remote Update Sequence:**
```
[🔍 REMOTE-UPDATE] Remote update event received
[🔍 REMOTE-UPDATE] Handling remote update for branch-b87d1560...
[🔍 REMOTE-UPDATE] Updating editor with remote content
[🔍 REMOTE-UPDATE] Calling onContentLoaded to update dataStore
[🔍 DATASTORE-UPDATE] handleEditorContentLoaded called for branch-b87d1560...
[🔍 DATASTORE-UPDATE] Updating dataStore for branch-b87d1560...
Preview: 'test from chrome test from firefox'
```

**Interpretation:**
- Remote update mechanism fires correctly
- Editor updates with remote content
- DataStore gets updated (localStorage persisted)
- Content syncs successfully

---

## Part 6: Your Verification Tasks

### Task 1: Safety Verification

**Questions to Answer:**

1. **localStorage Backup Analysis**
   - Read `tiptap-editor-plain.tsx` lines 1294-1305
   - Does content ALWAYS save to localStorage first?
   - Is localStorage save synchronous (blocking)?
   - Can any code path skip localStorage save?

2. **Recovery Mechanism Analysis**
   - Read `tiptap-editor-plain.tsx` lines 385-411
   - Does pending save restoration work correctly?
   - What is the max age before pending saves are discarded?
   - Can any race condition bypass recovery?

3. **Rapid Tab Switching Timeline**
   - Trace through the visibility change handler
   - What happens if user switches tabs < 100ms apart?
   - Does localStorage save complete before load starts?
   - Can content be lost permanently?

4. **Typing During Conflict Timeline**
   - Trace through the conflict resolution handler
   - What is the time window between save and conflict resolution?
   - Does the editor become non-editable during update?
   - How many characters can be lost realistically?

### Task 2: Correctness Verification

**Questions to Answer:**

1. **Event Flow Verification**
   - Does `provider.checkForRemoteUpdates()` always emit `document:remote-update`?
   - Is the event listener properly registered and cleaned up?
   - Can the event fire for the wrong panel?

2. **Version Consistency**
   - Does the provider cache get updated when remote content loads?
   - Does the editor's `loadedContent` state stay in sync?
   - Does the dataStore get updated with the new version?

3. **Edge Case Analysis**
   - What happens if database is unreachable during visibility change?
   - What happens if two browsers become visible simultaneously?
   - What happens if conflict occurs during remote update?

### Task 3: Safety Analysis Validation

**Verify These Claims:**

1. **Claim: "Rapid tab switching is SAFE"**
   - [ ] localStorage save is synchronous
   - [ ] Recovery mechanism exists and works
   - [ ] No permanent data loss possible
   - Verdict: TRUE / FALSE / NEEDS FIX

2. **Claim: "Typing during conflict loses only 2-5 characters"**
   - [ ] Time window is ~150ms
   - [ ] Probability is < 2% of edits
   - [ ] User notices (focus loss)
   - Verdict: TRUE / FALSE / OVERSTATED / UNDERSTATED

3. **Claim: "98% safe for production"**
   - [ ] No critical data loss scenarios
   - [ ] Edge cases are rare and minor
   - [ ] Comparable to industry standards
   - Verdict: AGREE / DISAGREE (explain)

### Task 4: Production Readiness Assessment

**Evaluate:**

1. **Data Loss Risk**: LOW / MEDIUM / HIGH
   - Permanent data loss scenarios: (list any found)
   - Temporary data loss scenarios: (list any found)
   - Recovery mechanisms: (evaluate effectiveness)

2. **User Experience Risk**: LOW / MEDIUM / HIGH
   - Confusing behavior: (list any found)
   - Silent failures: (list any found)
   - Error messages: (evaluate clarity)

3. **Deployment Recommendation**:
   - [ ] DEPLOY NOW - Safe for production
   - [ ] DEPLOY WITH WARNINGS - Document edge cases
   - [ ] DO NOT DEPLOY - Critical fixes required

   **Required fixes before deployment:** (list any)

---

## Part 7: Output Format

### Required Deliverables

1. **Executive Summary** (2-3 sentences)
   - Is it safe?
   - Main concerns (if any)
   - Recommendation

2. **Safety Assessment**
   - Data loss scenarios found (with reproduction steps)
   - Risk level for each scenario (LOW/MEDIUM/HIGH)
   - Comparison to safety analysis claims

3. **Correctness Assessment**
   - Does the implementation solve the original problem?
   - Are there any logic errors or race conditions?
   - Does it work as designed?

4. **Production Readiness**
   - DEPLOY NOW / DEPLOY WITH CAUTION / DO NOT DEPLOY
   - Required fixes (if any)
   - Optional improvements (if any)

5. **Validation of Safety Analysis**
   - Which claims are correct?
   - Which claims are incorrect?
   - Which claims are overstated/understated?

---

## Part 8: Files to Review

### Primary Implementation Files

1. **components/canvas/tiptap-editor-plain.tsx**
   - Lines 1203-1268: Remote update listener
   - Lines 1329-1351: Visibility-based refresh
   - Lines 1294-1305: localStorage backup
   - Lines 385-411: Recovery mechanism
   - Lines 1108-1201: Conflict resolution

2. **lib/providers/plain-offline-provider.ts**
   - Lines 762-768: Public checkForRemoteUpdates method
   - Lines 770-800: Private refreshDocumentFromRemote method
   - Lines 615-668: Optimistic concurrency control

3. **components/canvas/canvas-panel.tsx**
   - Lines 735-762: handleEditorContentLoaded (dataStore update)

### Reference Documents

1. **docs/proposal/extensible-annotation-types/reports/SAFETY-ANALYSIS-REVISED.md**
   - Complete safety analysis with claims to verify

2. **docs/proposal/extensible-annotation-types/reports/CROSS-BROWSER-SYNC-FIX.md**
   - Implementation details and how it works

---

## Part 9: Critical Questions

### Must Answer These

1. **Can permanent data loss occur?** If yes, under what conditions?

2. **Is the localStorage backup mechanism bulletproof?** Can it fail?

3. **What happens in this scenario:**
   - Firefox: User types "hello world"
   - User switches to Chrome (< 50ms)
   - User switches back to Firefox (< 50ms)
   - Does "hello world" survive?

4. **What happens in this scenario:**
   - Firefox: User types "hello", stops typing
   - Auto-save triggers (300ms later)
   - User resumes typing " world" (editor has "hello world")
   - Chrome saves, causing conflict
   - Conflict handler runs in Firefox
   - Does " world" survive?

5. **Is the implementation better or worse than:**
   - Google Docs conflict resolution?
   - Notion's sync mechanism?
   - The previous broken state?

6. **Should this be deployed to production?**
   - What are the risks?
   - What are the benefits?
   - What needs to be monitored?

---

## Part 10: Success Criteria

### The Implementation is SAFE if:

- ✅ No permanent data loss in any scenario
- ✅ Temporary data loss is < 5% probability and < 10 characters
- ✅ User is notified of any data changes (not silent)
- ✅ Recovery mechanisms exist and work
- ✅ Better than the previous state

### The Implementation is PRODUCTION-READY if:

- ✅ Meets all safety criteria
- ✅ Solves the original problem
- ✅ No critical bugs
- ✅ Edge cases are acceptable
- ✅ User testing is positive

---

## Your Task

Please conduct a thorough, independent verification of this implementation. Be critical, be thorough, and be honest. If you find critical issues, explain them clearly with reproduction steps. If you agree it's safe, explain why with evidence.

**Your analysis should be independent** - don't just agree with the safety analysis. Verify the claims yourself by reading the code and tracing through the execution paths.

**Focus on:**
1. Can data be permanently lost?
2. Are the safety claims accurate?
3. Should this be deployed to production?

Provide your assessment in the format specified in Part 7.
