# /context-status

Check the status and health of Context-OS features.

## Usage
```
/context-status [feature-slug]
/context-status --all
/context-status --summary
```

## Arguments
- `feature-slug` (optional): Specific feature to check
- `--all`: Show status of all features
- `--summary`: Show summary statistics only

## Examples

### Check specific feature
```
/context-status dark_mode
```

Output:
```
📊 Feature Status: dark_mode

Status: IN PROGRESS
Location: docs/proposal/dark_mode/
Created: 2025-01-07
Last Modified: 2025-01-08

Validation:
  ✅ Structure compliant
  ⚠️  2 warnings (non-blocking)

Fixes:
  🔴 Critical: 0
  🟠 High: 1 (1 open)
  🟡 Medium: 2 (1 open, 1 closed)
  🟢 Low: 3 (all closed)

Progress:
  Tasks: 8/12 complete (66%)
  Tests: Passing
  Documentation: Complete
```

### Check all features
```
/context-status --all
```

Output:
```
📊 All Features Status

✅ COMPLETE (3)
  - user_authentication
  - data_export
  - search_functionality

🔄 IN PROGRESS (2)
  - dark_mode (66% complete)
  - collaborative_editing (25% complete)

📝 PLANNED (1)
  - offline_mode

Total: 6 features
Health: 83% (5/6 active or complete)
```

### Summary only
```
/context-status --summary
```

Output:
```
📊 Context-OS Summary

Features: 6 total
  Complete: 3 (50%)
  In Progress: 2 (33%)
  Planned: 1 (17%)

Fixes: 24 total
  Open: 8 (33%)
  Closed: 16 (67%)

Validation:
  Passing: 5/6 (83%)
  Warnings: 12 total

Last Activity: 2 hours ago
```

## Implementation

The command collects status by:
1. Scanning `docs/proposal/` for features
2. Reading status from `implementation.md`
3. Counting fixes in `post-implementation-fixes/`
4. Running validation checks
5. Calculating progress metrics

## Integration

- Works with `/context-validate` for compliance
- Reads from `/context-fix` generated fixes
- Tracks `/context-execute` created features

## Error Handling

- Feature not found: Lists available features
- No features: Suggests creating first feature
- Validation errors: Shows specific issues

## JSON Mode

```bash
echo '{"feature": "dark_mode"}' | node context-os/cli/status-cli.js
```

Returns:
```json
{
  "ok": true,
  "feature": "dark_mode",
  "status": "IN PROGRESS",
  "progress": {
    "tasks": { "complete": 8, "total": 12 },
    "percentage": 66
  },
  "fixes": {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3
  },
  "validation": {
    "errors": 0,
    "warnings": 2
  }
}
```