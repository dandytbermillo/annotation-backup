 Fix: commandBypassesLabelMatching Stale State Leakage to
  Grounding LLM

   Context

   Problem: When commandBypassesLabelMatching fires in handleClarificationIntercept (e.g., "open the
   links panel plsss"), the input escapes with { handled: false } but stale
   lastClarification/pendingOptions are NOT cleared. Downstream Tier 4.5 grounding LLM inherits these
   stale options as candidates and auto-executes against them — producing incorrect "Opening Links
  Panel
    D..." instead of disambiguation.

   Root cause (two layers):
   1. Layer 1 — No clearing in intercept: The commandBypassesLabelMatching block at chat-
  routing.ts:4547
    falls through without clearing stale clarification state. It only logs and exits.
   2. Layer 2 — React async state: Even if we add setLastClarification(null) in the intercept, React
   state setters are async-batched. The sendMessage clin chat-navigation-panel.tsx still holds the
    stale lastClarification/pendingOptions values from the current render. These stale values get
  passed
    to dispatchRouting(ctx) and then to buildGroundingContext at routing-dispatcher.ts:2797-2802.

   Secondary issue: No _devProvenanceHint on the Tier 4.5 grounding execution path — so the
   auto-execution shows no badge at all (neither "Deterministic" nor "Auto-Executed").

   Fix: Two-part approach that handles both layers.

   ---
   Implementation Steps

   Step 1: Clear stale state + return immediately in commandBypassesLabelMatching

   File: lib/chat/chat-routing.ts:4547-4565

   Critical: Must return immediately after clearing. If we only clear and fall through, the rest of
   handleClarificationIntercept still uses the local lastClarification parameter (stale closure — the
   React setter doesn't update it).

   Existing pattern to follow: chat-routing.ts:5420-5428 (Tier 1b.3b new-question escape) already does
   exactly this — clear + return { handled: false, clarificaeared: true }.

   if (commandBypassesLabelMatching) {
     // Clear stale clarification state so downstream tiers don't inherit it.
     // Without this, Tier 4.5 grounding LLM picks up stale options as candidates.
     // MUST return immediately — local lastClarification param stays stale otherwise.
     if (lastClarification?.options?.length) {
       saveClarificationSnapshot(lastClarification)
       setLastClarification(null)
       setPendingOptions([])
       setPendingOptionsMessageId(null)
       setPendingOptionsGraceCount(0)
     }
     void debugLog({
       component: 'ChatNavigation',
       action: 'clarification_selection_bypassed_command_intent',
       metadata: {
         input: trimmedInput,
         activeOptionsCount: lastClarification?.options?.length ?? 0,
         isExplicitCommand: inputIsExplicitCommand,
         isNewQuestionOrCommandDetected,
         inputTargetsActiveOption,
         clarificationCleared: !!lastClarification?.options?.length,
         escapeReason: inputIsExplicitCommand ? 'explicit_command_priority'        : !
  lastClarification?.options?.length ? 'no_active_options'
           : 'command_bypass_not_selection_like',
       },
     })
     return {
       handled: false,
       clarificationCleared: !!lastClarification?.options?.length,
       isNewQuestionOrCommandDetected,
     }
   }

   Step 2: Gate downstream context in dispatchRouting

   File: lib/chat/routing-dispatcher.ts:~1187 — after handleClarificationIntercept returns { handled:
   false, clarificationCleared: true }.

   React state setters are async — ctx still holds old lastClarification/pendingOptions values. Must
   nullify on the ctx object so all downstream tiers (2a, 2c, 4, 4.5 grounding) see cleared state.

   const { clarificationCleared, isNewQuestionOrCommandDetected } = clarificationResult

   if (clarificationResult.handled) {
     // ... existing early return ...
   }

   // When commandBypassesLabelMatching cleared state but intercept didn't handle,
   // nullify stale ctx references so downstream tiers (esp. Tier 4.5 grounding) don't
   // inherit phantom optioneact state setters are async — ctx still holds old values.
   // Direct field mutation only — setters are async and don't protect same-turn reads.
   if (clarificationCleared) {
     ctx.lastClarification = null
     ctx.pendingOptions = []
     ctx.activeOptionSetId = null
   }

   Fields cleared (direct mutation only — no setter side effects for same-turn protection):
   - ctx.lastClarification = null — prevents buildGroundingContext (line 2800) from using stale
  options
   - ctx.pendingOptions = [] — prevents Tier 3a selection-only guard (line 1727) from matching
   - ctx.activeOptionSetId = null — prevents downstream paths from recovering old options by message-
  id
   (lines 563, 1727, 2039, 2451, 2484). Note: setPendingOptionsMessageId (line 171) is an alias for
   setActiveOptionSetId (line 164) — both point to this field

   Why no setters: Setters (setPendingOptionsGraceCount, setActiveOptionSetId, etc.) trigger React
  state
    updates that don't take effect until next render. Same-turn protection requires direct f on the
  ctx object.

   Type safety: lastClarification (LastClarificationState | null), pendingOptions
   (PendingOptionState[]), activeOptionSetId (string | null) are mutable fields on
   RoutingDispatcherContext (lines 157, 158, 162). Not readonly.

   Step 3: Sanitize API context in sendMessage

   File: components/chat/chat-navigation-panel.tsx:~1880-1997

   Even after dispatchRouting returns { handled: false }, the non-handled path calls /api/chat/
  navigate
   with pendingOptionsForContext (line 1988) and lastClarification (line 1997) from the closure. These
   are stale React state values — the setters from Step 1 haven't flushed yet.

   Source of clarificationCleared: Already destructured from routingResult at line 1535:
   const { clarificationCleared, isNewQuestionOrCommandDetected } = routingResult  // line 1535
   This is in sendMessage scope and available at the API call site (~line 1880+).

   Change pendingOptionsForContext from const to let and add override after it's built (line 1880-
  1887):

   // Build pending opons for LLM context (for free-form selection fallback)
   let pendingOptionsForContext = pendingOptions.length > 0
     ? pendingOptions.map((opt) => ({
         index: opt.index,
         label: opt.label,
         sublabel: opt.sublabel,
         type: opt.type,
       }))
     : undefined

   // Sanitize stale closure values when clarification was cleared this turn.
   // React state setters are async — pendingOptions/lastClarification still hold
   // pre-clear values in this render. Override to prevent server-side stale candidates.
   const sanitizedLastClarification = clarificationCleared ? null : lastClarification
   if (clarificationCleared) {
     pendingOptionsForContext = undefined
   }

   Then in the API call body (lines 1988, 1997), use the sanitized values:
   - Line 1988: pendingOptions: pendingOptionsForContext, — already uses variable; works after let +
   override
   - Line 1997: lastClarification: sanitizedLastClarification, — replace bare lastClarification

   Step 4: Add test for stale state leakage fix

   File: __testsegration/chat/universal-strict-exact-invariant.test.ts

   describe('commandBypassesLabelMatching stale state leakage', () => {
     test('non-matching command with active clarification clears state and returns immediately', async
   () => {
       // Setup: active clarification with options (e.g., Links Panel D, Links Panel E, Links Panels)
       // Input: "open the links panel plsss" — triggers commandBypassesLabelMatching
       //   (isNewQuestionOrCommandDetected, !isSelectionLike, !inputTargetsActiveOption because
  "plsss"
    doesn't match)
       // Assert:
       //   1. result.handled === false (escapes to downstream tiers)
       //   2. result.clarificationCleared === true
       //   3. setLastClarification called with null
       //   4. setPendingOptions called with []
       //   5. saveClarificationSnapshot called (preserves for recovery)
       //   6. handleSelectOption NOT called (no auto-execution)
     })
   })

   ---
   Files Modified

   File: lib/chat/chat-routing.ts:4547
   Change: Clear state + return immediately wit{ handled: false, clarificationCleared: true }
   ────────────────────────────────────────
   File: lib/chat/routing-dispatcher.ts:~1187
   Change: Nullify ctx.lastClarification, ctx.pendingOptions, ctx.activeOptionSetId when
     clarificationCleared && !handled
   ────────────────────────────────────────
   File: components/chat/chat-navigation-panel.tsx:~1880
   Change: Override pendingOptionsForContext → undefined and lastClarification → null in API body when
     clarificationCleared === true
   ────────────────────────────────────────
   File: __tests__/integration/chat/universal-strict-exact-invariant.test.ts
   Change: Add test for stale state leakage fix

   Files NOT Modified

   File: lib/chat/grounding-set.ts
   Why: buildGroundingContext reads from ctx.lastClarification — will see.