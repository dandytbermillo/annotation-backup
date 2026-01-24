# Clarification Exit Pills Plan

## Goal
When clarification is active and the user provides off‑menu input repeatedly, provide **explicit exit options** as pills:
- **None of these**
- **Start over**

This fulfills the escalation step defined in clarification-offmenu-handling-plan.md.

## Scope
**In scope**
- UI pills for exits during clarification escalation
- Deterministic handling of exit pill selection

**Out of scope**
- New LLM flows
- Retrieval logic changes

## Trigger Condition
Show exit pills when:
- clarification is active, and
- attemptCount >= MAX_ATTEMPT_COUNT (currently 3), and
- user input is off‑menu/unclear (re‑show options path)

## Behavior
### Exit Pills
- **None of these**: clears clarification and asks open‑ended question
- **Start over**: clears clarification and resets pending options; prompts user for new request

### Messaging
Use existing escalation message (Attempt 3) and append the exit pills below it.

## Integration Points
- Re‑show options path in `handleClarificationIntercept` / `handleUnclear` when escalation is triggered
- Selection handler: recognize exit pill types and execute their actions

## Telemetry
Log:
- `clarification_exit_pill_shown`
- `clarification_exit_pill_selected` with `exit_type` = `none` | `start_over`

## Acceptance Tests
1. After 3 off‑menu attempts, exit pills appear under the options.
2. Clicking **None of these** clears clarification and prompts: “What would you like to do instead?”
3. Clicking **Start over** clears clarification and prompts: “Okay — what do you want to do?”
4. Exit pills are **not** shown before attempt 3.

## Rollout
- No feature flag required; low risk UI addition.

