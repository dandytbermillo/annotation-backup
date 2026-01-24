# Off-Menu Handling Telemetry Baseline

**Date:** 2025-01-23
**Status:** Monitoring
**Related:** `clarification-offmenu-handling-plan.md`, `clarification-exit-pills-plan.md`

---

## Purpose

Establish baseline metrics for off-menu handling to inform future tuning decisions. Changes should be data-driven based on observed patterns, not assumptions.

---

## Current Metrics (Snapshot)

### Event Counts

| Event | Count | Notes |
|-------|-------|-------|
| `clarification_mode_intercept` | 432 | Total clarification interceptions |
| `clarification_shown` | 166 | Pills displayed to user |
| `clarification_tier1b3b_offmenu_mapping` | 26 | Off-menu mapping attempts |
| `clarification_offmenu_new_topic_check` | 23 | New topic detection ran |
| `clarification_offmenu_no_match_reshow` | 20 | No match, re-showed options |
| `clarification_exit_pill_shown` | 1 | Exit pills displayed (at attempt 3) |
| `clarification_exit_pill_selected` | 2 | Exit pills clicked |

### Off-Menu Mapping Results

| Result Type | Count | Examples |
|-------------|-------|----------|
| `canonical_subset_single` | 1 | `panels d` → mapped correctly |
| `multiple_options_match` | 2 | `panels`, `links panels` → ambiguous |
| `no_token_match` | 14 | Various (see patterns below) |

### New Topic Detection

| Outcome | Count | Examples |
|---------|-------|----------|
| Detected as new topic | 3 | `show me my profile`, `open panell e` |
| Not detected (correct) | 20 | `idk`, `hmm`, `my ids` (not clear commands) |

---

## Observed User Behavior Patterns

### 1. Uncertainty Expressions
Users expressing "I don't know which one":
- `i dunno` (2x)
- `idk` (1x)
- `dunno` (1x)
- `hmm`, `hmmv`, `hemm` (4x total)

**Current handling:** Treated as unclear → escalation message → re-show options
**Status:** Working as designed (gentle guidance before exit)

### 2. Gibberish/Frustration
Users giving up or testing:
- `dfsdfsdf` (1x)
- `ick` (1x)
- `my ids` (7x - same user, repeated attempts)

**Current handling:** No match → increment attemptCount → show exit pills at 3
**Status:** Working, but `my ids` 5+ attempts suggests possible max cap consideration

### 3. Successful New Topic Exits
Users pivoting to different intent:
- `show me my profile` → detected, exited clarification
- `open panell e` → detected (typo but unique tokens), exited

**Status:** Working correctly

### 4. Off-Topic Queries
Users asking about unrelated features:
- `settings please` → no match (options were Dashboard/Widget docs)
- `preferences` → no match (options didn't contain preferences)

**Status:** Correct behavior - options shown didn't contain these terms

---

## Exit Pill Usage

| Metric | Value |
|--------|-------|
| Exit pills shown | 1 (at attempt 3) |
| "None of these" selected | 1 |
| "Start over" selected | 1 |

**Status:** Exit pills are being used when shown. Current attempt threshold (3) appears appropriate.

---

## Micro-Alias Effectiveness

### Current Allowlist
```
panel/panels, widget/widgets, link/links, workspace/workspaces,
note/notes, setting/settings, preference/preferences,
personal/personalization/personalize, customize/customization/custom
```

### Verdict
No gaps identified. Cases like `settings please` failed because the option labels (e.g., "Dashboard > Overview") didn't contain settings-related terms - this is correct behavior.

**Recommendation:** No changes to allowlist. Expand only when telemetry shows repeated failures for terms that SHOULD match option labels.

---

## Key Findings

### What's Working Well
1. **Off-menu mapping** - Correctly maps when input tokens match option labels
2. **Ambiguity detection** - Correctly flags when multiple options match
3. **New topic detection** - Successfully detects clear commands with non-overlapping tokens
4. **Exit pills** - Shown at attempt 3, being used by users
5. **Escalation messaging** - Progressive messages guide users

### No Changes Needed
1. **Stopwords** - Current list is appropriate
2. **Micro-aliases** - Current allowlist is sufficient
3. **Exit phrases** - Current list handles explicit exits
4. **Attempt threshold** - 3 attempts before exit pills is appropriate

### Watch Items
1. **Repeated gibberish** - `my ids` 5+ times suggests possible max attempt cap (e.g., 5)
2. **Uncertainty expressions** - Monitor if "idk/dunno" users successfully use exit pills

---

## Recommendations

### Immediate
None. Current implementation is working as designed.

### Future Consideration
1. **Max attempt cap** - Consider auto-exit at attempt 5-6 to prevent endless loops
2. **Telemetry enrichment** - Log option labels alongside off-menu attempts for easier debugging

### Tuning Triggers
Revisit this baseline when:
- Off-menu no_match rate exceeds 70%
- Exit pill usage drops significantly
- User feedback indicates frustration with clarification loops

---

## Monitoring Queries

```sql
-- Off-menu mapping distribution
SELECT metadata->>'reason' as reason, COUNT(*)
FROM debug_logs
WHERE action = 'clarification_tier1b3b_offmenu_mapping'
GROUP BY metadata->>'reason';

-- Attempt count distribution
SELECT metadata->>'attemptCount' as attempts, COUNT(*)
FROM debug_logs
WHERE action = 'clarification_offmenu_no_match_reshow'
GROUP BY metadata->>'attemptCount'
ORDER BY attempts::int;

-- Exit pill effectiveness
SELECT action, COUNT(*)
FROM debug_logs
WHERE action LIKE 'clarification_exit_pill%'
GROUP BY action;

-- New topic detection accuracy
SELECT metadata->>'isNewTopic' as detected, COUNT(*)
FROM debug_logs
WHERE action = 'clarification_offmenu_new_topic_check'
GROUP BY metadata->>'isNewTopic';
```

---

## References

- [clarification-offmenu-handling-plan.md](../clarification-offmenu-handling-plan.md)
- [clarification-exit-pills-plan.md](../clarification-exit-pills-plan.md)
- [2025-01-23-clarification-offmenu-implementation-report.md](./2025-01-23-clarification-offmenu-implementation-report.md)
