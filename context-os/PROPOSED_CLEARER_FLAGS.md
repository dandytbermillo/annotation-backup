# Proposed: Clearer Command Flags for /context-execute

## The Problem (You're Right!)

Current commands are confusing:
```bash
/context-execute "Feature" --interactive  # What does this do?
/context-execute feature                   # What does THIS do?
```

Users can't tell which creates what just by looking at the command!

## Proposed Solution: Explicit Action Flags

### Option 1: Action-Based Flags (RECOMMENDED)

```bash
# Crystal clear what each does:
/context-execute "My Feature" --create-initial   # Creates INITIAL.md
/context-execute my_feature --create-prp         # Creates PRP
/context-execute my_feature --create-impl        # Creates implementation
```

### Option 2: Mode-Based Flags

```bash
/context-execute "My Feature" --mode=initial     # Creates INITIAL.md
/context-execute my_feature --mode=prp           # Creates PRP
/context-execute my_feature --mode=implement     # Creates implementation
```

### Option 3: Separate Commands (Most Clear)

```bash
/context-init "My Feature"        # Creates INITIAL.md (already exists!)
/context-prp my_feature           # Creates PRP
/context-implement my_feature     # Creates implementation
```

## Implementation Changes Needed

### 1. Update execute-cli.js

```javascript
// Current (confusing)
if (input.interactive) {
  // Creates INITIAL.md
}

// Proposed (clear)
if (input.createInitial || input.action === 'initial') {
  console.log('Creating INITIAL.md for new feature...');
  // Delegate to init-interactive
}
else if (input.createPrp || input.action === 'prp') {
  console.log('Creating PRP from existing INITIAL.md...');
  // Generate PRP
}
else if (input.createImpl || input.action === 'implement') {
  console.log('Creating implementation plan...');
  // Generate implementation
}
else {
  console.log('Please specify: --create-initial, --create-prp, or --create-impl');
}
```

### 2. Update Command Help

```bash
/context-execute --help

Purpose: Feature development workflow management

For NEW features (create INITIAL.md):
  /context-execute "Feature Name" --create-initial
  
For EXISTING features (create PRP):
  /context-execute feature_slug --create-prp
  
For IMPLEMENTATION:
  /context-execute feature_slug --create-impl

Examples:
  Step 1: /context-execute "Dark Mode" --create-initial
  Step 2: /context-execute dark_mode --create-prp
  Step 3: /context-execute dark_mode --create-impl
```

## Migration Path (Backward Compatible)

Keep old flags working while adding new ones:

```javascript
// Support both old and new
if (input.interactive || input.createInitial) {
  // Create INITIAL.md
}

// Show deprecation warning
if (input.interactive) {
  console.warn('⚠️ --interactive is deprecated. Use --create-initial instead.');
}
```

## Benefits of Clear Flags

### Before (Confusing):
```bash
/context-execute "Auth" --interactive  # What does interactive mean?
/context-execute auth                   # No flag = execute what?
```

### After (Crystal Clear):
```bash
/context-execute "Auth" --create-initial  # Obviously creates INITIAL.md
/context-execute auth --create-prp        # Obviously creates PRP
```

## User Experience Comparison

### Current (User's Internal Dialog):
```
"I need to run /context-execute... 
 but do I add --interactive? 
 What does interactive even mean?
 Will this create or execute something?"
```

### Proposed (User's Internal Dialog):
```
"I need to create INITIAL.md, so:
 /context-execute 'My Feature' --create-initial
 
 Done! Crystal clear!"
```

## Quick Implementation

Here's how to add this TODAY with minimal changes:

```javascript
// Add to execute-cli.js
async function execute(input) {
  // New clear flags
  const createInitial = input.createInitial || input['create-initial'];
  const createPrp = input.createPrp || input['create-prp'];
  
  // Clear messages
  if (createInitial) {
    console.log('📝 Creating INITIAL.md for new feature...');
    // Existing interactive logic
  }
  else if (createPrp) {
    console.log('📋 Creating PRP from INITIAL.md...');
    // PRP generation logic
  }
  else {
    // Show helpful error
    console.log(`
❓ Please specify what to create:

For new features:
  /context-execute "Feature Name" --create-initial

For PRP generation:
  /context-execute feature_slug --create-prp
    `);
  }
}
```

## Recommendation

**IMPLEMENT OPTION 1** with these flags:
- `--create-initial` (replaces --interactive)
- `--create-prp` (new, explicit)
- `--create-impl` (new, explicit)

This makes the user's intent CRYSTAL CLEAR in the command itself!

## Summary

You're absolutely right - the current syntax is confusing! Users shouldn't have to remember that:
- `--interactive` means "create INITIAL.md"
- No flag means "create PRP"

Instead, the flags should say EXACTLY what they do:
- `--create-initial` 
- `--create-prp`
- `--create-impl`

This would eliminate ALL confusion!