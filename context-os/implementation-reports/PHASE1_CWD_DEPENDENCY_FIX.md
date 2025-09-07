# Phase 1 CWD Dependency Fix Report

## Date: 2025-09-07

## Issue Identified

**YES**, this is definitely a Phase 1 issue that needs fixing!

The scripts use relative paths (`../scripts/`) that break when run from different directories.

## Files Affected

1. **cli/validate-cli.js**
   - Line 22: `const scriptPath = '../scripts/validate-doc-structure.sh';`
   - Line 44: `../docs/proposal/${input.feature}`

2. **create-feature.js**
   - Line 567: `const scriptPath = '../scripts/validate-doc-structure.sh';`

## The Problem

These relative paths assume the script is executed from a specific directory. This breaks when:
- Running from project root
- Running from CI/CD environments
- Running via npm scripts from different locations
- Running from user's arbitrary working directory

## Fixes Applied

### 1. cli/validate-cli.js

**Before**:
```javascript
const scriptPath = '../scripts/validate-doc-structure.sh';
// ...
const featurePath = `../docs/proposal/${input.feature}`;
```

**After**:
```javascript
const scriptPath = path.join(__dirname, '../scripts/validate-doc-structure.sh');
// ...
const featurePath = path.join(__dirname, '../..', 'docs/proposal', input.feature);
```

### 2. create-feature.js

**Before**:
```javascript
const scriptPath = '../scripts/validate-doc-structure.sh';
```

**After**:
```javascript
const scriptPath = path.join(__dirname, 'scripts/validate-doc-structure.sh');
```

## Why This Matters for Phase 1

1. **CLI Reliability**: Commands must work regardless of where they're invoked
2. **Automation**: Scripts and CI/CD need predictable behavior
3. **User Experience**: Users shouldn't need to cd to specific directories
4. **npm scripts**: npm can run from various working directories

## Testing

### Before Fix
```bash
cd /tmp
node /path/to/context-os/cli/validate-cli.js
# Error: Cannot find ../scripts/validate-doc-structure.sh
```

### After Fix
```bash
cd /tmp
node /path/to/context-os/cli/validate-cli.js
# Works correctly - finds script via __dirname
```

## Additional Recommendations

1. **Audit all files** for similar patterns:
   ```bash
   grep -r "\.\./scripts" .
   grep -r "\.\./docs" .
   ```

2. **Consider npm script wrappers** that set cwd:
   ```json
   "scripts": {
     "context:validate": "cd context-os && node cli/validate-cli.js"
   }
   ```

3. **Add tests** that run scripts from different directories

## Conclusion

This is a fundamental Phase 1 issue that affects:
- Command reliability
- CI/CD integration
- User experience
- Script portability

Using `path.join(__dirname, ...)` ensures scripts work from any directory, which is essential for a production-ready CLI tool.