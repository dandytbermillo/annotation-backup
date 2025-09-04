# Validate Documentation Structure

Validates a feature's documentation structure against the Documentation Process Guide.

## Feature: $ARGUMENTS

## Validation Process

1. **Check Arguments**
   - If no feature specified, validate entire docs/proposal/ directory
   - If feature name provided, validate that specific feature

2. **Run Validation Script**
   ```bash
   # For specific feature
   ./scripts/validate-doc-structure.sh ../docs/proposal/$ARGUMENTS
   
   # For all features (if no arguments)
   ./scripts/validate-doc-structure.sh
   ```

3. **Check Compliance**
   - Verify all required directories exist
   - Check for required files (implementation.md, reports/, etc.)
   - Validate status values (PLANNED, IN PROGRESS, COMPLETE, BLOCKED)
   - Ensure patches directory has README.md if exists

4. **Report Results**
   - Show validation errors with specific rule violations
   - Provide fix suggestions for common issues
   - Return success/failure status

## Error Handling

If validation fails:
- List specific missing directories/files
- Suggest using `/fix` command to auto-remediate
- Reference the Documentation Process Guide rules

## Example Usage

```
/validate dark_mode
/validate  # validates all features
```