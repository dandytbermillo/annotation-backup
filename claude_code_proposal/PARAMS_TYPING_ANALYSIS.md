# Next.js 15 Params Typing Analysis and Fix Proposal

**Date**: 2025-09-01  
**Author**: Claude Code  
**Status**: RECOMMENDATION

## Executive Summary

The expert's patch 0008 is **incorrect** and would break Next.js 15 compatibility. This document provides the correct fix and evidence.

## The Issue

Next.js 15 changed how dynamic route parameters work. In v15, params are now Promises that must be awaited. The expert incorrectly suggests reverting to synchronous params, which causes runtime errors.

## Evidence

### 1. Official Next.js 15 Documentation

From https://nextjs.org/docs/app/api-reference/file-conventions/route:

```typescript
export async function GET(
  request: Request,
  { params }: { params: Promise<{ team: string }> }
) {
  const { team } = await params
  // Handle the route logic
}
```

### 2. Runtime Test Results

When applying patch 0008 (synchronous params):
```
Error: Route "/api/versions/[noteId]/[panelId]" used `params.noteId`. 
`params` should be awaited before using its properties.
```

### 3. Current Codebase Status

#### Correctly Typed (Promise params - Next.js 15 compliant):
- `/api/versions/[noteId]/[panelId]/route.ts` ✅
- `/api/postgres-offline/documents/[noteId]/[panelId]/route.ts` ✅  
- `/api/postgres-offline/notes/[id]/route.ts` ✅
- `/api/persistence/load/[docName]/route.ts` ✅

#### Incorrectly Typed (needs fixing):
- `/api/postgres-offline/branches/[id]/route.ts` ❌ (uses synchronous params)

## Why The Expert Is Wrong

1. **Misunderstanding Next.js 15**: The expert claims "In Next.js 15, params is a plain object, not a Promise." This is factually incorrect per official docs.

2. **Cherry-picked Example**: The expert cites `/api/postgres-offline/branches/[id]/route.ts` as correct, but this file is actually buggy and needs fixing.

3. **Backwards Logic**: The expert wants to "fix" correct code to match buggy code, instead of fixing the buggy code.

## Proposed Fix

### Patch 0009: Fix Next.js 15 Params Typing

```diff
// app/api/postgres-offline/branches/[id]/route.ts
export async function PATCH(
  request: NextRequest,
-  { params }: { params: { id: string } }
+  { params }: { params: Promise<{ id: string }> }
) {
  try {
-    const { id } = params
+    const { id } = await params
```

This patch fixes the ONE incorrectly typed route to match Next.js 15 requirements.

## Recommendation

1. **DO NOT apply patch 0008** - it breaks Next.js 15 compatibility
2. **DO apply patch 0009** - fixes the one buggy route
3. **Keep current typing** in `/api/versions/*` routes - they're correct

## Testing

After applying patch 0009:
```bash
# No more warnings about sync dynamic APIs
curl http://localhost:3001/api/postgres-offline/branches/test-id
```

## Slug Support Status

### Current State:
- `/api/versions/*` endpoints: ✅ Accept slugs (UUID coercion implemented)
- `/api/postgres-offline/*` endpoints: ❌ Require UUID noteId (400 on slugs)

### Future Work:
Add UUID coercion to postgres-offline endpoints if slug support is needed there.

## Conclusion

The expert's assessment is partially correct about limited slug support but completely wrong about params typing. The current Promise-based params implementation in most routes is correct for Next.js 15. Only one route needs fixing, not the reverse.