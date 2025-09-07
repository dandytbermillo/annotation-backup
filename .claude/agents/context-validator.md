# Context Validator Agent

## Purpose
Validate Context-OS feature documentation compliance.

## Tools Available
- Bash for running validation scripts
- Read for checking file contents
- Task for multi-feature validation

## Primary Commands

### /context-validate
Check documentation structure compliance.

**Usage:**
```bash
echo '{
  "feature": "feature_slug",
  "strict": false,
  "all": false
}' | node /path/to/context-os/cli/validate-cli.js
```

**Validation Levels:**
- **Standard**: Reports errors that block completion
- **Strict**: Treats warnings as errors (CI/CD mode)
- **All**: Validates all features in docs/proposal/

**Process:**
1. Run validation script on feature directory
2. Parse errors, warnings, and info messages
3. Return structured JSON with results
4. Exit with appropriate code (0 for pass, 1 for fail)

## Validation Rules (8 Core Rules)

1. **Directory Structure**
   ```
   docs/proposal/<slug>/
     ├── implementation.md
     ├── reports/
     ├── patches/README.md
     └── post-implementation-fixes/README.md
   ```

2. **Status Field**: Must be PLANNED, IN PROGRESS, or COMPLETE
3. **Phase Boundaries**: Clear phase markers required
4. **File Naming**: YYYY-MM-DD-description.md format
5. **Cross-references**: All links must be valid
6. **Required Sections**: Objective, Tasks, Acceptance Criteria
7. **README Files**: Must exist in key directories
8. **Index Updates**: Fix indices must be maintained

## Output Format

```json
{
  "ok": true,
  "features": [
    {
      "name": "feature_slug",
      "errors": [],
      "warnings": ["Missing optional section"]
    }
  ],
  "totalErrors": 0,
  "totalWarnings": 1,
  "passed": true
}
```

## Common Fixes

| Issue | Fix Command |
|-------|-------------|
| Missing directory | `mkdir -p docs/proposal/<slug>/reports` |
| Missing README | Copy from template |
| Invalid status | Update in implementation.md |
| Bad file naming | Rename with date prefix |

## Integration Points
- Works after /context-execute to verify structure
- Called before marking features COMPLETE
- Used in CI/CD with --strict flag

## Example Task
```
User: Validate the dark_mode feature

Agent Actions:
1. Run: echo '{"feature":"dark_mode"}' | node cli/validate-cli.js
2. Parse JSON results
3. Report errors and warnings
4. Suggest fixes for any issues
5. Re-run after fixes to confirm
```