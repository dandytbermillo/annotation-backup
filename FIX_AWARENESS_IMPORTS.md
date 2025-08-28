# Fix Awareness Import Errors

## The Error
```
Attempted import error: 'Awareness' is not exported from 'yjs'
```

## The Solution
Install the required packages:
```bash
npm install y-protocols y-webrtc
```

## Why This Happens
- Awareness is part of y-protocols, not the main yjs package
- The code already has the correct imports: `import { Awareness } from 'y-protocols/awareness'`
- But the packages aren't installed yet

## Files That Need These Packages
1. `lib/sync/hybrid-sync-manager.ts` - Uses Awareness for presence
2. `lib/enhanced-yjs-provider-patch.ts` - Creates Awareness instances
3. Other sync-related files that handle real-time collaboration

## Quick Fix
Run:
```bash
./install-missing-deps.sh
```

This will install:
- `y-protocols` - Contains Awareness class
- `y-webrtc` - For WebRTC sync capabilities

## Note
These import errors don't affect the core TipTap persistence functionality, which is why the editor still works despite the console errors.