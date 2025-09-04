# Show Context-OS Features Status

Display the current status of all Context-OS features according to the Documentation Process Guide.

## Arguments: $ARGUMENTS

## Execution

Execute the stable features router script that always rebuilds data before displaying:

```bash
bash .claude/commands/features.sh $ARGUMENTS
```

This command scans `docs/proposal/` for all features and displays their current status based on the Documentation Process Guide rules.

## What it shows

- **Feature slug**: Directory name in docs/proposal/
- **Status**: From implementation.md (PLANNED, IN PROGRESS, COMPLETE, BLOCKED)  
- **Files**: Total file count in the feature directory
- **Fixes**: Number of post-implementation fixes
- **Modified**: Last modification date

## Documentation Process Guide Compliance

This command validates features against the Documentation Process Guide v1.4.5:
- Checks for required directory structure
- Verifies implementation.md exists
- Counts post-implementation fixes (Rule 4)
- Respects status enforcement (Rule 5)

## Options

- No arguments: Show all features
- `--refresh`: Force refresh with confirmation message

## Note

The command always rebuilds the feature data from the filesystem, ensuring you see the current state regardless of any caching.