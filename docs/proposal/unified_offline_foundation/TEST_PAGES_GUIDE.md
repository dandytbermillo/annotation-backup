# Unified Offline Foundation - Test Pages Guide

## Overview
Interactive test pages for validating each phase of the Unified Offline Foundation implementation.

## Test Pages

### Phase 0: Foundation Test Page
**URL**: http://localhost:3000/offline-test  
**File**: `app/offline-test/page.tsx`  
**Purpose**: Test foundation components

#### Components Tested:
- **Feature Flags System**: Runtime toggles with localStorage persistence
- **Telemetry System**: Event tracking and metrics collection
- **E2E Test Harness**: Mock mode and testing utilities
- **Health Check**: Backend connectivity verification

#### How to Use:
1. Test Feature Flags - Verify localStorage persistence
2. Toggle individual flags (circuitBreaker, swCaching, conflictUI)
3. Test Telemetry API endpoints
4. Send manual telemetry events
5. Enable mock mode for offline simulation
6. Monitor real-time logs

---

### Phase 1: Connectivity Test Page
**URL**: http://localhost:3000/phase1-test  
**File**: `app/phase1-test/page.tsx`  
**Purpose**: Test network detection and circuit breaker

#### Components Tested:
- **Network Detector**: Real-time connectivity monitoring
- **Circuit Breaker**: Failure handling with backoff
- **Health Endpoint**: GET/HEAD health checks
- **Connectivity Badge**: Visual network status

#### How to Use:
1. Enable Circuit Breaker flag and refresh
2. Monitor real-time network status badge
3. Test health endpoints
4. Force network probes
5. Simulate failures and test circuit breaker
6. View circuit statistics

---

### Phase 2: Service Worker Test Page
**URL**: http://localhost:3000/phase2-test  
**File**: `app/phase2-test/page.tsx`  
**Purpose**: Test Service Worker caching and write replay

#### Components Tested:
- **Service Worker**: Registration and lifecycle
- **Cache Management**: Stale-while-revalidate caching
- **Write Replay**: Offline write queueing
- **PWA Support**: Install prompt and manifest

#### How to Use:
1. Enable SW Caching and refresh
2. Register Service Worker
3. Seed test data (creates sample notes)
4. Test cache hits (verify speed improvement)
5. Test offline writes (queue operations)
6. Check cache and queue status

---

## Test Flow

### Recommended Testing Sequence:

1. **Start with Phase 0** (`/offline-test`)
   - Verify all foundation components work
   - Ensure feature flags persist correctly
   - Test telemetry pipeline

2. **Progress to Phase 1** (`/phase1-test`)
   - Enable circuit breaker flag
   - Verify network detection works
   - Test health endpoint connectivity

3. **Complete with Phase 2** (`/phase2-test`)
   - Enable SW caching flag
   - Register Service Worker
   - Test cache performance
   - Verify offline write queueing

## Quick Commands

```bash
# Start development server
npm run dev

# Access test pages
open http://localhost:3000/offline-test   # Phase 0
open http://localhost:3000/phase1-test    # Phase 1
open http://localhost:3000/phase2-test    # Phase 2

# Clear all offline state (run in browser console)
localStorage.removeItem('offlineFeatureFlags')
navigator.serviceWorker.getRegistrations().then(r => r.forEach(sw => sw.unregister()))

# Check current feature flags (browser console)
JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}')
```

## Feature Flags

| Flag | Phase | Default | Purpose |
|------|-------|---------|---------|
| `offline.circuitBreaker` | 1 | OFF | Enables network detection and circuit breaker |
| `offline.swCaching` | 2 | OFF | Enables Service Worker caching |
| `offline.conflictUI` | 3 | OFF | Enables conflict resolution UI (future) |

## Color Coding

Each phase uses a distinct color scheme:
- **Phase 0**: Blue/Indigo gradient (Foundation)
- **Phase 1**: Indigo/Purple gradient (Connectivity)
- **Phase 2**: Purple/Pink gradient (Service Worker)

## Tips

- Always start with flags OFF and enable as needed
- Clear browser state between major tests
- Use browser DevTools to monitor network/SW activity
- Check console logs for detailed debugging info
- Test in both online and offline modes

## Troubleshooting

### Service Worker Not Registering
1. Clear site data in DevTools
2. Ensure `offline.swCaching` flag is enabled
3. Refresh page after enabling flag
4. Click "Register SW" button

### Telemetry Flooding
1. Clear localStorage flags
2. Restart dev server
3. Telemetry is throttled in dev mode (45s intervals)

### App Stuck Loading
1. Check `NEXT_PUBLIC_COLLAB_MODE=plain` in `.env.local`
2. Clear all feature flags
3. Restart dev server

## Success Indicators

### Phase 0
- All feature flags toggle correctly
- Telemetry GET/POST return 200
- Logs show "PASSED" for all tests

### Phase 1
- Network badge shows real-time status
- Circuit breaker transitions states correctly
- Health checks return quickly

### Phase 2
- Service Worker status shows "REGISTERED"
- Cache hits are significantly faster than misses
- Queue operations tracked correctly