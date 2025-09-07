# Context-OS Companion Service - Comprehensive Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Companion Service](#companion-service)
4. [Web Interface](#web-interface)
5. [Library Modules](#library-modules)
6. [API Reference](#api-reference)
7. [Security Features](#security-features)
8. [Data Flow](#data-flow)
9. [Installation & Setup](#installation--setup)
10. [Usage Examples](#usage-examples)

---

## System Overview

Context-OS is a feature planning and documentation system that helps teams create structured INITIAL.md documents for feature requests. It consists of:

- **Companion Service**: Node.js/Express backend API (port 4000)
- **Web Interface**: Next.js/React frontend with Monaco editor
- **File System**: Local storage for drafts and final documents
- **LLM Integration**: Claude API for content verification and suggestions

### Key Features
- Real-time markdown editing with Monaco Editor
- Auto-save and validation
- Draft management with versioning
- LLM-powered content verification and filling
- Concurrent edit protection with locks
- Comprehensive audit logging
- CSRF protection and security middleware

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Browser                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Context-OS Web Interface                   │   │
│  │         (Next.js React Application)                  │   │
│  │  - Monaco Editor for Markdown                        │   │
│  │  - Real-time validation UI                          │   │
│  │  - LLM interaction panels                           │   │
│  └──────────────────┬──────────────────────────────────┘   │
└─────────────────────┼────────────────────────────────────────┘
                      │ HTTP/REST API
                      ▼
┌──────────────────────────────────────────────────────────────┐
│              Companion Service (server-v2.js)                │
│                    Express Server                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Core Services                        │   │
│  │  - SessionManager: User/session tracking              │   │
│  │  - ETagManager: Version control                       │   │
│  │  - SecurityMiddleware: CSRF, rate limiting           │   │
│  │  - AuditLogger: Activity logging                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  File Operations                      │   │
│  │  - AtomicFileOps: Safe file writes                   │   │
│  │  - LockManager: Concurrent edit protection           │   │
│  │  - Backup rotation and recovery                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                Content Processing                     │   │
│  │  - YAMLValidator: Metadata validation                │   │
│  │  - MarkdownParser: Section extraction                │   │
│  │  - ContentValidator: Structure validation            │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬─────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┬─────────────────┐
         ▼                       ▼                 ▼
┌──────────────┐      ┌──────────────┐   ┌──────────────┐
│ File System  │      │  Claude API  │   │   Postgres   │
│              │      │              │   │  (future)    │
│ .tmp/initial/│      │ Verification │   │              │
│ docs/proposal│      │ Suggestions  │   │              │
└──────────────┘      └──────────────┘   └──────────────┘
```

---

## Companion Service

### Core Server (`server-v2.js`)

The main Express server that coordinates all operations:

```javascript
// Initialization
const app = express();
const PORT = process.env.COMPANION_PORT || 4000;

// Service initialization
const sessionManager = new SessionManager();
const auditLogger = new AuditLogger(sessionManager);
const etagManager = new ETagManager();
const security = new SecurityMiddleware();
const fileOps = new AtomicFileOps(auditLogger);
const lockManager = new LockManager(auditLogger);

// Middleware setup
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(security.middleware());

// Bind to localhost only for security
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Context-OS Companion V2 running on http://127.0.0.1:${PORT}`);
});
```

### Directory Structure

```
context-os/
├── companion/
│   ├── server-v2.js          # Main server file
│   ├── server.js             # Legacy server (v1)
│   ├── lib/
│   │   ├── atomic-file-ops.js    # Safe file operations
│   │   ├── audit-logger.js       # Activity logging
│   │   ├── etag-manager.js       # Version control
│   │   ├── lock-manager.js       # Concurrent edit protection
│   │   ├── security.js           # Security middleware
│   │   ├── session-manager.js    # User/session tracking
│   │   ├── yaml-validator.js     # YAML parsing
│   │   ├── markdown-parser.js    # Markdown processing
│   │   └── redactor.js          # Sensitive data redaction
│   └── backups/              # Automatic backup storage
├── .tmp/
│   ├── initial/              # Draft storage
│   └── locks/                # Lock files
└── docs/
    └── proposal/             # Final INITIAL.md storage
        └── {feature_slug}/
            └── INITIAL.md
```

---

## Web Interface

### Main Component (`page-v2.tsx`)

React component with comprehensive state management:

```typescript
export default function ContextOSPageV2() {
  // Core state
  const [content, setContent] = useState('');
  const [etag, setEtag] = useState('');
  const [csrfToken, setCsrfToken] = useState('');
  
  // Status tracking
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  // Validation & verification
  const [validationResult, setValidationResult] = useState<any>(null);
  const [reportCard, setReportCard] = useState<ReportCard | null>(null);
  
  // Auto-save with debouncing (900ms)
  useEffect(() => {
    if (isDirty && content) {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => saveDraft(), 900);
    }
  }, [content, isDirty]);
  
  // Auto-validate after save (800ms)
  useEffect(() => {
    if (content && !isDirty) {
      if (validateTimeout.current) clearTimeout(validateTimeout.current);
      validateTimeout.current = setTimeout(() => validateDraft(), 800);
    }
  }, [content, isDirty]);
}
```

### UI Components

- **Monaco Editor**: Rich markdown editing with syntax highlighting
- **Status Bar**: Real-time readiness score and validation status
- **LLM Panel**: Three-tab interface (Report, Fill, PRP)
- **Action Buttons**: Verify, Fill, Create PRP

---

## Library Modules

### 1. SessionManager
Manages user identification and session tracking:

```javascript
class SessionManager {
  constructor() {
    this.sessionId = uuidv4();
    this.userId = this.getOrCreateUserId();
    this.startTime = Date.now();
  }
  
  getOrCreateUserId() {
    const userFile = path.join(os.homedir(), '.context-os', 'user.json');
    // Creates persistent user ID in ~/.context-os/user.json
  }
}
```

### 2. ETagManager
Implements optimistic concurrency control:

```javascript
class ETagManager {
  generate(slug) {
    const timestamp = Date.now();
    this.counter++;
    const etag = `v${timestamp}-${this.counter}`;
    this.etags.set(slug, etag);
    return etag;
  }
  
  validate(slug, provided) {
    const current = this.etags.get(slug);
    return provided === current;
  }
  
  hash(content) {
    return crypto.createHash('sha256')
      .update(content, 'utf8')
      .digest('hex')
      .substring(0, 16);
  }
}
```

### 3. AtomicFileOps
Ensures safe file operations with automatic backups:

```javascript
class AtomicFileOps {
  async write(filepath, content) {
    const temp = `${filepath}.tmp.${Date.now()}`;
    const backup = await this.createBackup(filepath);
    
    // Write to temp file
    await fs.writeFile(temp, content, 'utf8');
    
    // Force sync to disk
    const fd = await fs.open(temp, 'r+');
    await fd.sync();
    await fd.close();
    
    // Atomic rename
    await fs.rename(temp, filepath);
    
    return { success: true, backup };
  }
  
  async rotateBackups(filepath) {
    // Keeps only last 5 backups
  }
}
```

### 4. LockManager
Prevents concurrent edits with auto-release:

```javascript
class LockManager {
  async acquireLock(slug, userId, sessionId) {
    const lockFile = path.join(this.lockDir, `${slug}.lock`);
    
    // Check existing lock
    const existing = await this.checkExistingLock(lockFile);
    if (existing && existing.sessionId !== sessionId) {
      return {
        acquired: false,
        owner: existing.userId,
        message: `${existing.userId} is editing`
      };
    }
    
    // Create lock with 30s timeout
    const lock = { userId, sessionId, timestamp: Date.now() };
    await fs.writeFile(lockFile, JSON.stringify(lock));
    
    // Auto-release after timeout
    setTimeout(() => this.releaseLock(slug, sessionId), 30000);
    
    return { acquired: true };
  }
}
```

### 5. SecurityMiddleware
Comprehensive security features:

```javascript
class SecurityMiddleware {
  middleware() {
    return (req, res, next) => {
      // Origin validation
      if (!this.checkOrigin(req)) {
        return res.status(403).json({ error: 'Invalid origin' });
      }
      
      // CSRF protection for mutations
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const token = req.headers['x-csrf-token'];
        if (!this.validateCSRF(token)) {
          // Currently logging only for development
        }
      }
      
      // Rate limiting (10 requests per second)
      if (!this.checkRateLimit(`${req.ip}:${req.path}`)) {
        return res.status(429).json({ error: 'Rate limited' });
      }
      
      // Idempotency support
      const idempotencyKey = req.headers['x-idempotency-key'];
      if (idempotencyKey) {
        const check = this.checkIdempotency(idempotencyKey);
        if (check.duplicate) {
          return res.json(check.result);
        }
      }
      
      next();
    };
  }
}
```

### 6. AuditLogger
Comprehensive activity logging with redaction:

```javascript
class AuditLogger {
  log(action, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...this.session.getContext(),
      ...this.redactor.redactForLog(data)
    };
    
    // Append to .logs/context-os-companion.jsonl
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
  }
  
  async rotate() {
    // Archives and compresses old logs
  }
}
```

---

## API Reference

### Endpoints

#### GET /api/csrf
Get CSRF token for session:
```javascript
// Response
{
  "token": "32-byte-hex-string"
}
```

#### GET /api/health
Health check endpoint:
```javascript
// Response
{
  "status": "ok",
  "version": "2.0.0",
  "session": {
    "userId": "user_hostname_timestamp",
    "sessionId": "uuid-v4",
    "uptime": 12345
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### GET /api/draft/:slug
Get or create draft:
```javascript
// Request
GET /api/draft/my_feature

// Response
{
  "slug": "my_feature",
  "content": "# INITIAL\n\n**Title**: My Feature\n...",
  "path": ".tmp/initial/my_feature.draft.md",
  "exists": true,
  "etag": "v1234567890-1",
  "lockStatus": null
}
```

#### POST /api/draft/save
Save draft with optimistic locking:
```javascript
// Request
{
  "slug": "my_feature",
  "content": "# INITIAL\n\n## Problem\n...",
  "etag": "v1234567890-1"
}

// Response
{
  "saved": true,
  "path": ".tmp/initial/my_feature.draft.md",
  "etag": "v1234567890-2",
  "backup": "backups/my_feature.draft.md.bak.2025-01-01T00-00-00",
  "timestamp": "2025-01-01T00:00:00.000Z"
}

// Error responses
409: { "error": "Stale ETag", "code": "STALE_ETAG" }
423: { "error": "Resource locked", "code": "RESOURCE_LOCKED" }
```

#### POST /api/validate
Validate draft structure:
```javascript
// Request
{
  "slug": "my_feature",
  "etag": "v1234567890-2"
}

// Response
{
  "ok": true,
  "readiness_score": 7,
  "missing_fields": ["stakeholders"],
  "found_fields": ["problem", "goals", "acceptance_criteria"],
  "warnings": [],
  "confidence": 0.85,
  "stats": {
    "word_count": 450,
    "section_count": 5
  },
  "etag": "v1234567890-2",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### POST /api/llm/verify
LLM-powered verification:
```javascript
// Request
{
  "slug": "my_feature",
  "etag": "v1234567890-2",
  "validationResult": { /* from /api/validate */ }
}

// Response
{
  "header_meta": {
    "status": "draft",
    "readiness_score": 7,
    "missing_fields": ["stakeholders"],
    "confidence": 0.85,
    "last_validated_at": "2025-01-01T00:00:00.000Z"
  },
  "suggestions": [
    "Add more detail to problem statement",
    "Include specific metrics in acceptance criteria"
  ],
  "prp_gate": {
    "allowed": false,
    "reason": "Missing required sections",
    "next_best_action": "Complete stakeholders section"
  },
  "stats": { /* document statistics */ },
  "offline_mode": false
}
```

#### POST /api/draft/promote
Promote draft to final:
```javascript
// Request
{
  "slug": "my_feature",
  "etag": "v1234567890-3",
  "approveHeader": true,
  "approveContent": true
}

// Response
{
  "promoted": true,
  "path": "docs/proposal/my_feature/INITIAL.md",
  "backup": "backups/INITIAL.md.bak.2025-01-01T00-00-00",
  "etag": "v1234567890-4",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## Security Features

### 1. Path Traversal Protection
```javascript
normalizePath(slug) {
  return slug
    .replace(/\.\./g, '')        // Remove parent directory references
    .replace(/[^\w-]/g, '_')      // Allow only alphanumeric and dash
    .substring(0, 100);           // Limit length
}
```

### 2. Origin Validation
```javascript
checkOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  // Only allow localhost origins for development
  return origin.includes('localhost') || origin.includes('127.0.0.1');
}
```

### 3. Rate Limiting
- 10 requests per second per IP/path combination
- Sliding window algorithm
- Returns 429 status when exceeded

### 4. CSRF Protection
- Token generation with 15-minute expiry
- Required for all mutation operations
- Currently in warning mode for development

### 5. Idempotency Support
- Prevents duplicate operations
- 5-minute cache for idempotency keys
- Returns cached result for duplicate requests

---

## Data Flow

### 1. Draft Creation Flow
```
User loads page → Frontend requests draft → 
Backend checks .tmp/initial/ → 
If not exists, checks docs/proposal/ → 
If not exists, creates from template → 
Returns content with ETag
```

### 2. Save Flow
```
User types → 900ms debounce → 
Frontend sends content + ETag → 
Backend validates ETag → 
Acquires lock → 
Creates backup → 
Atomic write → 
Updates ETag → 
Releases lock → 
Returns new ETag
```

### 3. Validation Flow
```
Save completes → 800ms delay → 
Frontend requests validation → 
Backend parses markdown → 
Checks required sections → 
Calculates readiness score → 
Returns validation result
```

### 4. LLM Verification Flow
```
User clicks Verify → 
Frontend sends content + validation → 
Backend calls Claude API → 
Analyzes quality → 
Returns report card → 
Frontend displays in panel
```

### 5. Promotion Flow
```
User approves PRP creation → 
Backend validates readiness → 
Creates PRP from INITIAL.md → 
If ready, promotes to docs/proposal/ → 
Creates backup → 
Updates status to frozen
```

---

## Installation & Setup

### Prerequisites
- Node.js 18+
- npm or pnpm
- Next.js application at port 3000

### Installation

1. Install dependencies:
```bash
cd context-os
npm install
```

2. Start companion service:
```bash
node companion/server-v2.js
# Server starts on http://127.0.0.1:4000
```

3. Start web interface:
```bash
cd annotation-backup
npm run dev
# Access at http://localhost:3000/context-os?feature=my_feature
```

### Environment Variables
```bash
# .env.local
NEXT_PUBLIC_COMPANION_URL=http://localhost:4000
COMPANION_PORT=4000
```

---

## Usage Examples

### 1. Creating a New Feature

Navigate to: `http://localhost:3000/context-os?feature=dark_mode`

The system will:
1. Create a draft at `.tmp/initial/dark_mode.draft.md`
2. Load template with required sections
3. Enable auto-save and validation
4. Show real-time readiness score

### 2. Editing Workflow

```typescript
// Auto-save triggers after 900ms of inactivity
setContent("## Problem\nUsers need dark mode for night usage");
// → Saves to .tmp/initial/dark_mode.draft.md
// → Updates ETag
// → Triggers validation after save

// Validation runs 800ms after save
// → Checks required sections
// → Updates readiness score
// → Shows missing fields
```

### 3. LLM Integration

```typescript
// Click "LLM Verify" button
handleVerify() {
  // Sends to /api/llm/verify
  // Gets quality report from Claude
  // Displays in Report tab
}

// Click "LLM Fill" for missing sections
handleFill() {
  // Analyzes missing_fields
  // Gets content suggestions
  // Shows patches to apply
}
```

### 4. Creating PRP

```typescript
// When readiness_score >= 7
handleCreatePRP() {
  // Creates PRP from INITIAL.md
  // If approved, promotes to docs/proposal/
  // Sets status to 'frozen'
  // Blocks further semantic edits
}
```

---

## Monitoring & Debugging

### Audit Logs
Located at `.logs/context-os-companion.jsonl`:
```json
{
  "timestamp": "2025-01-01T00:00:00.000Z",
  "action": "draft_save",
  "userId": "user_hostname_123456",
  "sessionId": "uuid-v4",
  "slug": "dark_mode",
  "etag": "v1234567890-2",
  "size": 1024
}
```

### Common Issues

1. **CSRF Token Errors**
   - Token expires after 15 minutes
   - Frontend auto-refreshes on failure

2. **Lock Conflicts**
   - 30-second auto-release
   - Check `.tmp/locks/` for stale locks

3. **ETag Mismatches**
   - Frontend reloads on 409 response
   - Merges changes if needed

4. **Validation Failures**
   - Check console for detailed errors
   - Verify markdown structure

---

## Architecture Decisions

### Why Express over Fastify?
- Simpler middleware ecosystem
- Better debugging tools
- Sufficient performance for use case

### Why File System over Database?
- Simpler deployment
- Direct git integration
- Human-readable storage

### Why ETag over Timestamps?
- More reliable conflict detection
- Handles clock skew
- Supports content hashing

### Why Atomic File Operations?
- Prevents corruption
- Automatic backups
- Safe concurrent access

---

## Future Enhancements

1. **PostgreSQL Integration**
   - Already scaffolded in architecture
   - Will enable multi-user collaboration
   - Real-time synchronization

2. **Enhanced LLM Features**
   - Auto-complete suggestions
   - Grammar and style checking
   - Template generation

3. **Collaboration Features**
   - Real-time cursors
   - Comment threads
   - Change tracking

4. **Extended Validation**
   - Custom validation rules
   - Team-specific templates
   - Compliance checking

---

## Conclusion

The Context-OS Companion Service provides a robust, secure, and user-friendly system for creating and managing feature documentation. Its modular architecture, comprehensive security features, and intelligent auto-save/validation mechanisms ensure data integrity while providing an excellent user experience.

The combination of local file storage with optional LLM enhancement strikes a balance between simplicity and power, making it suitable for both individual developers and teams working on feature planning and documentation.