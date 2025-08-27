# IMMEDIATE ACTIONS CHECKLIST

This checklist contains practical, immediate improvements that can be implemented right away to address critical security, safety, and consistency issues.

## 🚨 CRITICAL SECURITY FIXES (Do These First)

### 1. ❌ Admin Routes Have No Authentication
**Files:** `/app/api/admin/notes/route.ts`, `/app/api/admin/sync/route.ts`
```typescript
// Add at the top of each admin route handler:
const authHeader = request.headers.get('authorization')
if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

### 2. ❌ Hardcoded Database Credentials
**File:** `/docker-compose.yml`
```yaml
# Replace hardcoded credentials with environment variables:
environment:
  POSTGRES_USER: ${POSTGRES_USER:-postgres}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
  POSTGRES_DB: ${POSTGRES_DB:-annotation_system}
```

### 3. ❌ Missing Environment Variable Template
**Action:** Create `.env.example`
```bash
# Database
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/annotation_system
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=annotation_system

# Security
ADMIN_API_KEY=your-secure-admin-key-here

# Pool Configuration
POSTGRES_POOL_SIZE=10
POSTGRES_IDLE_TIMEOUT=30000
POSTGRES_CONNECTION_TIMEOUT=2000
```

## 🛡️ SAFETY IMPROVEMENTS

### 4. ⚠️ SQL Injection Risk in Admin Route
**File:** `/app/api/admin/notes/route.ts` (lines 35-50)
```typescript
// Current: Direct string interpolation for ORDER BY
// Fix: Use a whitelist approach (already partially implemented)
const ALLOWED_SORT_COLUMNS = new Set(['created_at', 'updated_at', 'title', 'word_count', 'last_sync_at'])
const ALLOWED_SORT_ORDERS = new Set(['asc', 'desc'])

if (!ALLOWED_SORT_COLUMNS.has(sortBy)) {
  return NextResponse.json({ error: 'Invalid sort column' }, { status: 400 })
}
```

### 5. ⚠️ Missing Input Size Validation
**File:** `/app/api/persistence/route.ts`
```typescript
// Add size limits for update data:
const MAX_UPDATE_SIZE = 10 * 1024 * 1024 // 10MB
if (update && update.length > MAX_UPDATE_SIZE) {
  return createErrorResponse('Update size exceeds limit', 413)
}
```

### 6. ⚠️ No Rate Limiting
**Action:** Add rate limiting middleware
```typescript
// Create /lib/middleware/rate-limit.ts
const rateLimit = new Map<string, { count: number; resetTime: number }>()

export function checkRateLimit(clientId: string, limit = 100, window = 60000): boolean {
  const now = Date.now()
  const client = rateLimit.get(clientId)
  
  if (!client || client.resetTime < now) {
    rateLimit.set(clientId, { count: 1, resetTime: now + window })
    return true
  }
  
  if (client.count >= limit) return false
  client.count++
  return true
}
```

## 🔧 CONSISTENCY FIXES

### 7. 📝 Inconsistent Error Response Format
**Files:** Multiple API routes
```typescript
// Create /lib/api/response-helpers.ts
export interface ApiError {
  error: string
  code?: string
  details?: any
  timestamp: string
}

export function apiError(message: string, status: number, code?: string, details?: any): NextResponse {
  const error: ApiError = {
    error: message,
    code,
    details,
    timestamp: new Date().toISOString()
  }
  return NextResponse.json(error, { status })
}
```

### 8. 📝 Missing TypeScript Types
**File:** Create `/types/api.ts`
```typescript
export interface PersistenceAction {
  action: 'persist' | 'load' | 'getAllUpdates' | 'clearUpdates' | 'saveSnapshot' | 'loadSnapshot' | 'compact'
  params: Record<string, any>
}

export interface PersistenceResponse<T = any> {
  data?: T
  error?: string
  timestamp: string
}
```

## 📚 DOCUMENTATION FIXES

### 9. 📖 Missing API Documentation
**Action:** Create `/docs/api-reference.md`
```markdown
# API Reference

## Authentication
All admin endpoints require Bearer token authentication:
```
Authorization: Bearer YOUR_ADMIN_API_KEY
```

## Endpoints

### POST /api/persistence
Handles YJS document persistence operations...

### GET /api/admin/notes
Lists all notes with filtering and pagination...
```

### 10. 📖 Missing Setup Instructions
**Action:** Update `README.md` with:
```markdown
## Quick Start

1. Copy environment template:
   ```bash
   cp .env.example .env
   ```

2. Update `.env` with your settings

3. Start PostgreSQL:
   ```bash
   docker compose up -d postgres
   ```

4. Run migrations:
   ```bash
   npm run db:migrate
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```
```

## ⚙️ DEFAULT CONFIGURATION

### 11. 🔧 Add Health Check Endpoint
**File:** Create `/app/api/health/route.ts`
```typescript
import { NextResponse } from 'next/server'
import { testConnection } from '@/lib/db/postgres-pool'

export async function GET() {
  const dbHealthy = await testConnection()
  const status = dbHealthy ? 200 : 503
  
  return NextResponse.json({
    status: dbHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealthy ? 'connected' : 'disconnected'
    }
  }, { status })
}
```

### 12. 🔧 Add Request Logging
**File:** Update `/lib/api/persistence-helpers.ts`
```typescript
export function logApiOperation(
  operation: string,
  docName: string,
  success: boolean,
  duration: number,
  error?: any
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    operation,
    docName,
    success,
    duration,
    error: error?.message
  }
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[API]', JSON.stringify(logEntry))
  }
}
```

## 🚀 IMPLEMENTATION ORDER

1. **Security First** (Items 1-3): Add authentication, fix credentials, create .env.example
2. **Safety** (Items 4-6): Fix SQL injection risks, add input validation, implement rate limiting
3. **Consistency** (Items 7-8): Standardize error responses and add TypeScript types
4. **Documentation** (Items 9-10): Document API and setup process
5. **Configuration** (Items 11-12): Add health checks and logging

## ✅ VERIFICATION

After implementing each fix:
1. Test the specific endpoint/feature
2. Run existing tests: `npm test`
3. Check for TypeScript errors: `npm run type-check`
4. Verify in browser: `npm run dev`

## 🔍 QUICK WINS (< 5 minutes each)
- Create `.env.example` file
- Add authentication check to admin routes
- Create health check endpoint
- Add TypeScript interfaces for API types
- Update README with setup instructions