# Understanding the --from Parameter in /context-execute

## Overview
The `--from` parameter in `/context-execute` is **OPTIONAL**. This document clarifies its behavior and best practices.

## Behavior

### When --from IS PROVIDED (Recommended)
```bash
/context-execute --feature "User Profile" --from drafts/user-profile-feature.md
```
- Uses the specified draft file
- **Preserves the original filename** when moving to feature directory
- Example: `drafts/user-profile-feature.md` → `docs/proposal/user_profile/user-profile-feature.md`

### When --from IS NOT PROVIDED (Interactive Mode)
```bash
/context-execute --feature "User Profile"
```
1. **Creates a minimal plan on-the-fly**
2. **Prompts user interactively for missing fields**
3. **Then**: Prompts user interactively for missing fields:
   - Feature Slug
   - Status
   - Objective
   - Implementation Tasks
   - Acceptance Criteria

## Best Practices

### ✅ Recommended Approach
1. Create a descriptively-named draft plan:
   ```bash
   cp context-os/templates/INITIAL.md drafts/user-profile-feature.md
   vim drafts/user-profile-feature.md  # Fill out all fields
   ```

2. Execute with the plan:
   ```bash
   /context-execute --feature "User Profile" --from drafts/user-profile-feature.md
   ```

**Benefits:**
- Preserves semantic filename
- Avoids interactive prompts
- Ensures all required fields are included
- Creates cleaner documentation

### ⚡ Quick Start (Interactive)
For quick prototyping or when you don't have a plan ready:
```bash
/context-execute --feature "Quick Test Feature"
```
The system will guide you through filling in required fields.

## Parameter Aliases
- `--from <path>` - Current recommended parameter
- `--plan <path>` - Legacy alias, works the same as `--from`

## Common Scenarios

### Scenario 1: Full Planning Process
```bash
# 1. Create detailed plan
vim drafts/authentication-system.md

# 2. Execute with plan
/context-execute --feature "Authentication System" --from drafts/authentication-system.md

# Result: docs/proposal/authentication_system/authentication-system.md
```

### Scenario 2: Quick Feature Creation
```bash
# Execute without plan
/context-execute --feature "Search Feature"

# System prompts for:
# - Feature slug? > search_feature
# - Objective? > Add search functionality
# - Tasks? > [interactive input]
# - Acceptance criteria? > [interactive input]
```

### Scenario 3: Using Descriptive Draft Files
```bash
# Create descriptively-named draft file
echo "# My Feature\n..." > drafts/my-awesome-feature.md

# Execute with the draft
/context-execute --feature "My Feature" --from drafts/my-awesome-feature.md

# Result: Preserves filename as my-awesome-feature.md in docs/proposal/my_feature/
```

## Summary
- `--from` is **OPTIONAL** but **RECOMMENDED**
- Without it, system enters **interactive mode**
- Original filenames are **preserved** when provided
- Interactive mode is useful for **quick prototypes**
- Draft plans ensure **complete documentation**