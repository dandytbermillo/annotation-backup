# Original Error Report - High CPU Usage

**Date Discovered**: 2025-09-02  
**Reported By**: User observation during development

## Issue Description
Extremely high CPU usage observed during Next.js development with multiple setInterval timers accumulating.

## Symptoms Observed

### CPU Usage Monitoring
```bash
$ ps aux | grep next
dandy  1936  147.6  3.4 35459088 574224   ??  R     1:11PM  29:39.06 /usr/local/bin/node /Users/dandy/Downloads/annotation_project/annotation-backup/node_modules/.bin/next dev -p 3001
```

### Process Investigation
Multiple Node.js processes consuming excessive CPU:
- Main Next.js dev server: 147.6% CPU
- Hot Module Replacement causing interval accumulation
- Memory usage also elevated at 574MB

## Impact
- Development environment becoming unusable
- System fans running at maximum
- Significant battery drain on laptops
- Developer productivity severely impacted

## Root Cause (Discovered Later)
setInterval timers in batch API routes were not being cleaned up during Hot Module Replacement (HMR), causing them to accumulate with each code change.

## Affected Files
- `app/api/postgres-offline/documents/batch/route.ts`
- `app/api/postgres-offline/branches/batch/route.ts`
- `app/api/postgres-offline/panels/batch/route.ts`
- `lib/sync/hybrid-sync-manager.ts`