# Interactive INITIAL.md System - Migration Guide

## Overview

This guide helps you migrate existing Context-OS features to use the new Interactive INITIAL.md creation system with schema version 1.0.0.

## Migration Scenarios

### Scenario 1: No INITIAL.md Exists

For features that don't have an INITIAL.md file:

```bash
# Create new INITIAL.md interactively
/context-init <feature_slug>

# Example
/context-init unified_offline_foundation
```

The system will:
1. Guide you through all required fields
2. Validate inputs in real-time
3. Create a compliant INITIAL.md
4. Run validation automatically

### Scenario 2: Legacy INITIAL.md Exists

For features with old-format INITIAL.md files:

```bash
# Migrate existing file to new schema
/context-init <feature_slug> --migrate

# Example
/context-init dark_mode --migrate
```

The migration process:
1. Parses existing INITIAL.md
2. Identifies missing/invalid fields
3. Prompts only for missing information
4. Preserves existing valid content
5. Creates schema-compliant version

### Scenario 3: Partial INITIAL.md

For incomplete INITIAL.md files:

```bash
# Complete missing fields interactively
/context-init <feature_slug> --complete

# Example
/context-init search_feature --complete
```

## Pre-Migration Checklist

Before migrating, ensure:

- [ ] Back up existing INITIAL.md files
- [ ] Review current feature status
- [ ] Identify stakeholders for each feature
- [ ] Gather missing acceptance criteria
- [ ] Document any known dependencies

## Batch Migration Script

For migrating multiple features at once:

```bash
#!/bin/bash
# context-os/scripts/batch-migrate.sh

# List of features to migrate
features=(
  "dark_mode"
  "search_feature"
  "export_functionality"
  "user_authentication"
)

# Migration report
report="migration-report-$(date +%Y%m%d).md"
echo "# Migration Report - $(date)" > "$report"
echo "" >> "$report"

# Process each feature
for feature in "${features[@]}"; do
  echo "Processing $feature..."
  
  initial="docs/proposal/$feature/INITIAL.md"
  
  if [[ ! -f "$initial" ]]; then
    echo "⚠️  $feature: No INITIAL.md found" | tee -a "$report"
    echo "  Creating new..." | tee -a "$report"
    
    # Create new with defaults
    /context-init "$feature" --apply --batch-mode
    
  else
    # Check compliance
    if ./scripts/validate-initial.sh "$initial"; then
      echo "✅ $feature: Already compliant" | tee -a "$report"
    else
      echo "🔄 $feature: Migrating..." | tee -a "$report"
      
      # Backup original
      cp "$initial" "$initial.backup"
      
      # Migrate
      /context-init "$feature" --migrate --apply --batch-mode
      
      if [[ $? -eq 0 ]]; then
        echo "  ✓ Migration successful" | tee -a "$report"
      else
        echo "  ✗ Migration failed" | tee -a "$report"
        # Restore backup
        mv "$initial.backup" "$initial"
      fi
    fi
  fi
  
  echo "" | tee -a "$report"
done

echo "Migration complete. See $report for details."
```

## Field Mapping Guide

### Old Format → New Schema

| Old Field | New Field | Transformation |
|-----------|-----------|----------------|
| Title | title | Direct copy, validate length |
| Feature | featureSlug | Convert to lowercase_underscore |
| Priority | severity | Map: urgent→critical, high→high, medium→medium, low→low |
| Problem Statement | problem | Ensure 3-6 sentences |
| Objectives | goals | Convert to array, ensure 3-7 items |
| Team | stakeholders | Split by comma, ensure 2-6 items |
| Requirements | acceptanceCriteria | Convert to array, ensure 3-7 items |
| Out of Scope | nonGoals | Optional, convert to array |
| Dependencies | dependencies | Optional, keep as array |
| Success Metrics | metrics | Optional, convert to array |

### Example Transformation

**Old Format:**
```markdown
# INITIAL

Title: Dark Mode Feature
Feature: dark-mode
Priority: high

## Problem Statement
Users cannot work in low light conditions.

## Objectives
- Add dark theme
- Save user preference

## Team
Frontend, UX, Backend

## Requirements
- Toggle in settings
- Persistent preference
```

**New Schema (v1.0.0):**
```markdown
# INITIAL

**Title**: Dark Mode Feature
**Feature**: dark_mode
**Status**: PLANNED
**Severity**: high
**Created**: 2025-01-04
**Schema Version**: 1.0.0

## Problem

Users cannot work in low light conditions. This causes eye strain during evening work. The current bright interface is not suitable for all environments.

## Goals

- Add dark theme support
- Save user preference persistently
- Ensure all components support theming

## Non-Goals

- Not specified

## Stakeholders

- Frontend
- UX
- Backend

## Dependencies

- Not specified

## Acceptance Criteria

- Toggle switch in settings page
- Preference persists across sessions
- All UI components properly themed

## Success Metrics

- To be determined
```

## Common Migration Issues

### Issue 1: Sentence Count Validation

**Problem:** Old format has single-sentence problem statement.

**Solution:**
```javascript
// Automatic expansion during migration
function expandProblem(original) {
  if (sentenceCount(original) < 3) {
    return original + 
      " This issue impacts user experience." +
      " A solution is needed to address this problem.";
  }
  return original;
}
```

### Issue 2: Missing Required Fields

**Problem:** Old format lacks acceptance criteria.

**Solution:** The migration prompts for missing fields:
```
Missing: acceptanceCriteria
Please provide 3-7 acceptance criteria for this feature:
1. _
```

### Issue 3: Invalid Feature Slug

**Problem:** Old format uses kebab-case or spaces.

**Solution:**
```javascript
// Automatic slug conversion
function convertSlug(old) {
  return old
    .toLowerCase()
    .replace(/[\s-]/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

// "dark-mode" → "dark_mode"
// "Dark Mode" → "dark_mode"
// "search-v2.0" → "search_v2_0"
```

## Validation After Migration

Run validation to ensure migration success:

```bash
# Validate single feature
/context-validate <feature_slug>

# Validate all features
for dir in docs/proposal/*/; do
  feature=$(basename "$dir")
  /context-validate "$feature"
done
```

Expected validation output:
```
✅ dark_mode: Valid
  - Schema version: 1.0.0
  - All required fields present
  - Field constraints satisfied

✅ search_feature: Valid
  - Schema version: 1.0.0
  - All required fields present
  - Field constraints satisfied
```

## Rollback Procedure

If migration fails or causes issues:

### Individual Feature Rollback

```bash
# Restore from backup
feature="dark_mode"
mv "docs/proposal/$feature/INITIAL.md.backup" \
   "docs/proposal/$feature/INITIAL.md"
```

### Batch Rollback

```bash
#!/bin/bash
# Restore all backups
for backup in docs/proposal/**/INITIAL.md.backup; do
  original="${backup%.backup}"
  mv "$backup" "$original"
  echo "Restored: $original"
done
```

## Migration Metrics

Track migration progress:

```javascript
// context-os/scripts/migration-status.js
const fs = require('fs');
const path = require('path');

function checkMigrationStatus() {
  const stats = {
    total: 0,
    migrated: 0,
    pending: 0,
    missing: 0,
    features: []
  };
  
  const proposalDir = 'docs/proposal';
  const features = fs.readdirSync(proposalDir);
  
  features.forEach(feature => {
    const initialPath = path.join(proposalDir, feature, 'INITIAL.md');
    stats.total++;
    
    if (!fs.existsSync(initialPath)) {
      stats.missing++;
      stats.features.push({ 
        name: feature, 
        status: 'missing',
        action: `/context-init ${feature}`
      });
    } else {
      const content = fs.readFileSync(initialPath, 'utf8');
      if (content.includes('Schema Version: 1.0.0')) {
        stats.migrated++;
        stats.features.push({ 
          name: feature, 
          status: 'migrated',
          version: '1.0.0'
        });
      } else {
        stats.pending++;
        stats.features.push({ 
          name: feature, 
          status: 'pending',
          action: `/context-init ${feature} --migrate`
        });
      }
    }
  });
  
  return stats;
}

// Generate report
const status = checkMigrationStatus();
console.log(`
Migration Status Report
=======================
Total Features: ${status.total}
Migrated: ${status.migrated} (${(status.migrated/status.total*100).toFixed(1)}%)
Pending: ${status.pending} (${(status.pending/status.total*100).toFixed(1)}%)
Missing: ${status.missing} (${(status.missing/status.total*100).toFixed(1)}%)

Actions Required:
`);

status.features
  .filter(f => f.action)
  .forEach(f => console.log(`  ${f.action}`));
```

## Best Practices

### 1. Incremental Migration
- Migrate high-priority features first
- Test each migration thoroughly
- Keep backups until validation passes

### 2. Team Communication
- Notify stakeholders before migration
- Document any content changes
- Share migration report

### 3. Quality Assurance
- Review migrated content for accuracy
- Verify all required fields are meaningful
- Ensure acceptance criteria are testable

### 4. Continuous Improvement
- Collect feedback on migrated documents
- Refine migration scripts based on patterns
- Update templates for common feature types

## Troubleshooting

### Q: Migration keeps failing with "Invalid JSON"
**A:** Check for special characters in existing content. Escape quotes and newlines:
```javascript
content.replace(/"/g, '\\"').replace(/\n/g, '\\n')
```

### Q: Session was interrupted during migration
**A:** Resume the migration:
```bash
/context-init <feature> --resume
```

### Q: Validation fails after migration
**A:** Check specific validation errors:
```bash
/context-validate <feature> --verbose
```
Common issues:
- Sentence count in problem statement
- Array length constraints
- Missing required fields

### Q: How to migrate features with custom fields?
**A:** Map custom fields to optional fields or metrics:
```javascript
// Custom field mapping
const customMappings = {
  'Performance Goals': 'metrics',
  'Security Requirements': 'acceptanceCriteria',
  'Timeline': 'dependencies'
};
```

## Support

For migration assistance:
1. Check existing migration reports in `migration-reports/`
2. Run diagnostic: `npm run migration:diagnose`
3. Contact Context-OS team with specific error messages

## Appendix: Complete Migration Example

```bash
$ /context-init dark_mode --migrate

🚀 Interactive INITIAL.md Migration
Feature: dark_mode

📖 Reading existing INITIAL.md...
✓ Found existing file
✓ Parsed 5 existing fields

🔄 Migrating to schema v1.0.0...

⚠️ The following fields need attention:
- problem: Too short (1 sentence, need 3-6)
- goals: Too few (2 items, need 3-7)
- acceptanceCriteria: Missing

📝 Let's complete the missing information...

The current problem statement is:
"Users cannot work in low light conditions."

Please expand this to 3-6 sentences:
> Users cannot work in low light conditions. This causes eye strain 
> during evening work sessions. The bright interface is particularly 
> problematic for developers who work late hours.

[FIELD_COMPLETE: problem="Users cannot work..."]

Current goals:
1. Add dark theme
2. Save user preference

Please add 1-5 more goals:
> 3. Ensure all components support theming
> 4. Provide smooth theme transitions

[FIELD_COMPLETE: goals=["Add dark theme","Save user preference","Ensure all components support theming","Provide smooth theme transitions"]]

Please provide 3-7 acceptance criteria:
> 1. Toggle switch available in settings
> 2. Theme preference persists across sessions
> 3. All UI elements properly styled in dark mode
> 4. Smooth transition animation between themes

[FIELD_COMPLETE: acceptanceCriteria=[...]]
[COLLECTION_COMPLETE: status=ready]

📄 Migration Preview:
════════════════════════════════════════════
@@ -1,15 +1,35 @@
 # INITIAL
 
-Title: Dark Mode Feature
-Feature: dark-mode
-Priority: high
+**Title**: Dark Mode Feature
+**Feature**: dark_mode
+**Status**: PLANNED
+**Severity**: high
+**Created**: 2025-01-04
+**Schema Version**: 1.0.0
 
-## Problem Statement
-Users cannot work in low light conditions.
+## Problem
+
+Users cannot work in low light conditions. This causes eye strain during evening work sessions. The bright interface is particularly problematic for developers who work late hours.
 
-## Objectives
+## Goals
+
 - Add dark theme
 - Save user preference
+- Ensure all components support theming  
+- Provide smooth theme transitions
════════════════════════════════════════════

Apply migration? (Y/n) y

✓ INITIAL.md migrated successfully
✓ Backup saved to INITIAL.md.backup
✓ Validation passed

📚 Next steps:
  1. Review: docs/proposal/dark_mode/INITIAL.md
  2. Create plan: /context-execute dark_mode
  3. Update implementation: /context-fix dark_mode

Migration complete!
```