# Context-OS Browser MVP Implementation Plan

> Production-ready implementation incorporating expert feedback
> Status: READY FOR IMPLEMENTATION
> Created: 2025-09-05

## Executive Summary

Transform the Context-OS INITIAL.md creation from a confusing CLI experience to a browser-first workflow with clear preview-approve-save semantics. The system maintains strict quality gates while providing escape hatches for draft work.

## Core Principle: "Show, Don't Surprise"

Every action must:
1. Preview what will happen (diff/report)
2. Require explicit approval
3. Create atomic backups
4. Log to audit trail
5. Be reversible/rejectable

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser UI    │────▶│  Companion API   │────▶│  Claude Adapter │
│  (Next.js)      │◀────│  (Node/Express)  │◀────│  (Mock → Real)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                          │
        ▼                       ▼                          ▼
   [Editor/Diffs]        [File I/O + Valid]         [LLM Orchestration]
```

## Implementation Sequence (Revised with Security First)

### Phase 1: Foundation (Day 1-2)
1. **ETag Infrastructure**
   - Monotonic version tracking
   - Stale request rejection
   - Hash-based conflict detection

2. **Security Layer** ⚠️ (Moved up per expert)
   - Bind to 127.0.0.1 only
   - CSRF token generation/validation
   - Origin checking (localhost:3000)
   - Path whitelist with slug normalization
   - Rate limiting (10 req/s per action)
   - Idempotency keys

3. **Atomic File Operations**
   - Write to temp → fsync → atomic rename
   - Backup rotation (keep last 5)
   - Crash recovery detection
   - Lock files for concurrent access

### Phase 2: Core Functionality (Day 3-4)
4. **Real Validator Integration**
   - Wire `validate-doc-structure.sh`
   - Parse output to structured format
   - Share rubric constants module

5. **Section-Scoped Patching**
   - Markdown section parser
   - Bounded section replacement
   - Diff generation per section
   - Preserve document structure

6. **Header Meta Management**
   - YAML front-matter parsing
   - Separate approval lane
   - Status transition rules
   - Validation provenance tracking

### Phase 3: LLM Integration (Day 5)
7. **PRP Gating Logic**
   - Just-in-time re-validation
   - Strict vs Draft paths
   - Banner/TODO injection for drafts
   - Frozen state enforcement

8. **Diff Visualization**
   - Unified diff display
   - Side-by-side comparison
   - Section-specific diffs
   - Original vs current tracking

### Phase 4: UX Polish (Day 6)
9. **Smart Gate UI**
   - Three-option modal (proceed/edit/help)
   - Clear error messaging
   - Keyboard shortcuts (⌘S, ⌘↵, ⌥↵)
   - Focus management

10. **Contract Tests**
    - Stale ETag rejection
    - Concurrent promote conflicts
    - Frozen edit attempts
    - PRP draft override validation

## Detailed Component Specifications

### 1. ETag System

```typescript
interface ETagManager {
  generate(): string;           // "v{timestamp}-{counter}"
  validate(provided: string, current: string): boolean;
  increment(): string;
  hash(content: string): string; // SHA256 for conflict detection
}

// Usage
POST /draft/save { slug, content, etag: "v123" }
→ 409 Conflict if etag !== current
→ 200 OK { etag: "v124", ... }
```

### 2. Security Implementation

```typescript
interface SecurityMiddleware {
  csrfToken: {
    generate(): string;
    validate(token: string): boolean;
    rotate(): void; // Every 15 minutes
  };
  
  pathValidator: {
    normalize(slug: string): string;    // Remove ../, unicode tricks
    isAllowed(path: string): boolean;   // Check against whitelist
    whitelist: ['.tmp/initial/', 'docs/proposal/'];
  };
  
  rateLimit: {
    key: string;        // "action:slug:ip"
    limit: number;      // 10 req/s
    window: number;     // 1000ms
  };
  
  idempotency: {
    key: string;        // Client-provided UUID
    cache: Map;         // Recent operations
    ttl: number;        // 5 minutes
  };
}
```

### 3. Atomic File Operations

```typescript
interface AtomicFileOps {
  async write(path: string, content: string): Promise<void> {
    const temp = `${path}.tmp.${Date.now()}`;
    const backup = `${path}.bak.${Date.now()}`;
    
    // 1. Write to temp
    await fs.writeFile(temp, content);
    await fs.fsync(temp);  // Force to disk
    
    // 2. Create backup if exists
    if (await exists(path)) {
      await fs.rename(path, backup);
      await rotateBackups(path, 5); // Keep last 5
    }
    
    // 3. Atomic rename
    await fs.rename(temp, path);
    
    // 4. Audit log
    await audit.log('file_write', { path, backup });
  }
}
```

### 4. Frozen State Rules

```typescript
interface FrozenStateManager {
  canEdit(field: string, status: string): boolean {
    if (status !== 'frozen') return true;
    
    const semanticFields = ['problem', 'goals', 'intent_summary'];
    if (semanticFields.includes(field)) {
      return false; // Requires explicit unfreeze
    }
    
    return true; // Non-semantic edits allowed
  };
  
  unfreeze(slug: string, reason: string): void {
    audit.log('unfreeze', { slug, reason });
    // Reset status to 'ready'
    // Clear linked_report
    // Bump meta_version
  };
}
```

### 5. PRP Draft Override

```typescript
const DRAFT_BANNER = `
⚠️ DRAFT PRP - INITIAL.md not ready
Missing fields: {missing_fields}
This PRP contains TODOs that must be resolved.
`;

const TODO_TEMPLATE = `
<!-- TODO: {field} is required but missing.
     Please provide: {description}
     Example: {example} -->
`;

function injectDraftMarkers(prp: string, missing: string[]): string {
  let marked = DRAFT_BANNER.replace('{missing_fields}', missing.join(', '));
  marked += '\n\n' + prp;
  
  for (const field of missing) {
    const todo = TODO_TEMPLATE
      .replace('{field}', field)
      .replace('{description}', getFieldDescription(field))
      .replace('{example}', getFieldExample(field));
    
    marked = marked.replace(`## ${field}`, `## ${field}\n${todo}`);
  }
  
  return marked;
}
```

### 6. Audit Log Schema

```typescript
interface AuditEntry {
  timestamp: string;      // ISO 8601
  action: AuditAction;    // 'save' | 'verify' | 'fill' | 'promote' | 'prp'
  slug: string;
  etag: string;
  user?: string;          // From session if available
  diffHash?: string;      // SHA of changes
  result: 'success' | 'failure' | 'conflict';
  metadata: {
    backup?: string;
    validation?: ValidationResult;
    error?: string;
  };
}

// JSONL format in .logs/context-os-companion.jsonl
{"timestamp":"2025-09-05T20:00:00Z","action":"save","slug":"dark_mode","etag":"v124",...}
```

### 7. Shared Rubric Module

```typescript
// context-os/lib/readiness-rubric.js
export const READINESS_CONFIG = {
  THRESHOLD: 7,                    // Minimum score for 'ready'
  FREEZE_THRESHOLD: 9,              // Auto-freeze if score >= 9
  
  SCORING: {
    hasTitle: 1,
    hasProblem: 2,
    hasGoals: 2,
    hasAcceptanceCriteria: 2,
    hasStakeholders: 1,
    hasNonGoals: 1,
    hasDependencies: 1,
  },
  
  REQUIRED_FIELDS: [
    'title', 'problem', 'goals', 
    'acceptanceCriteria', 'stakeholders'
  ],
  
  FIELD_CONSTRAINTS: {
    title: { min: 5, max: 80 },
    problem: { sentences: { min: 3, max: 6 } },
    goals: { count: { min: 3, max: 7 } },
    acceptanceCriteria: { count: { min: 3, max: 7 } },
    stakeholders: { count: { min: 2, max: 6 } }
  }
};
```

## API Contracts (Final)

```typescript
// All endpoints return consistent error format
interface APIError {
  error: string;
  code: 'STALE_ETAG' | 'PATH_FORBIDDEN' | 'RATE_LIMITED' | 'VALIDATION_FAILED';
  details?: any;
}

// Endpoints with CSRF token required in headers
POST /api/draft/save 
  Body: { slug, content, etag }
  Response: { saved: true, path, etag, backup? }

POST /api/draft/diff 
  Body: { slug, etag }
  Response: { unified: string, sections: SectionDiff[], etag }

POST /api/validate 
  Body: { slug, etag }
  Response: { ok, missing_fields, warnings, tool_version, etag }

POST /api/llm/verify 
  Body: { slug, etag }
  Response: ReportCard

POST /api/llm/fill 
  Body: { slug, etag, targetSections? }
  Response: { content_patches, header_patch, notes }

POST /api/draft/promote 
  Body: { slug, etag, approveHeader, approveContent }
  Response: { finalPath, backupPath, etag }

POST /api/prp/create 
  Body: { slug, mode: 'strict'|'draft', etag }
  Response: { artifact, gate, warnings? }

POST /api/frozen/unfreeze
  Body: { slug, reason, etag }
  Response: { unfrozen: true, newStatus, etag }
```

## Contract Tests

```javascript
describe('Companion Security & Consistency', () => {
  test('rejects stale etag', async () => {
    const { etag: v1 } = await save(slug, content1);
    const { etag: v2 } = await save(slug, content2);
    
    await expect(validate(slug, v1)).rejects.toThrow('STALE_ETAG');
  });
  
  test('prevents concurrent promote', async () => {
    const promises = [
      promote(slug, etag),
      promote(slug, etag)
    ];
    
    const results = await Promise.allSettled(promises);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  
  test('blocks frozen semantic edits', async () => {
    await setStatus(slug, 'frozen');
    
    await expect(
      save(slug, updatedProblem, etag)
    ).rejects.toThrow('FROZEN_FIELD');
  });
  
  test('draft PRP contains banner and TODOs', async () => {
    const missing = ['goals', 'acceptanceCriteria'];
    const { artifact } = await createPRP(slug, 'draft', etag);
    
    expect(artifact.content).toContain('⚠️ DRAFT PRP');
    expect(artifact.content).toContain('TODO: goals');
    expect(artifact.content).toContain('TODO: acceptanceCriteria');
  });
});
```

## Definition of Done (MVP Checklist)

### Companion
- [ ] Draft-only writes to `.tmp/initial/<slug>.draft.md`
- [ ] Promote endpoint with atomic rename
- [ ] Real validator integration returning structured data
- [ ] PRP gate with just-in-time re-validation
- [ ] Section-scoped diff service
- [ ] Header patch as separate approval lane
- [ ] Atomic writes with backup rotation
- [ ] ETag-based race condition prevention
- [ ] Path whitelist + slug normalization
- [ ] CSRF token validation
- [ ] Rate limiting (10 req/s)
- [ ] Audit log to JSONL

### Browser UI
- [ ] Autosave with debouncing (~900ms)
- [ ] Auto-validate after save
- [ ] Status bar: chip + score + timestamp + missing
- [ ] Three buttons with correct behavior
- [ ] Diff UI with separate header/content approvals
- [ ] Smart gate modal for blocked PRP
- [ ] Per-section "Fix" quick actions
- [ ] Keyboard shortcuts (⌘S, ⌘↵, ⌥↵)
- [ ] Clear error messages for all failure modes

### LLM Integration
- [ ] Report card with all required fields
- [ ] Section-scoped fill responses
- [ ] No direct file writes
- [ ] Shared readiness rubric
- [ ] Mock mode for testing

### Tests
- [ ] Stale ETag rejection
- [ ] Concurrent operations
- [ ] Frozen state enforcement
- [ ] PRP draft markers
- [ ] Backup creation
- [ ] Audit logging

## Success Metrics

1. **Verify returns within 2s of save** (performance)
2. **Zero data loss** (atomicity)
3. **Clear user intent** (no confusion about what will happen)
4. **Quality gate adherence** (>90% of PRPs from ready state)
5. **Audit completeness** (100% of operations logged)

## Timeline

- Day 1-2: Foundation (ETag, Security, Atomic Ops)
- Day 3-4: Core (Validator, Patching, Header Meta)
- Day 5: LLM Integration
- Day 6: UX Polish & Tests
- Day 7: Integration testing & documentation

## Next Steps

1. Create feature branch: `feat/context-os-browser-mvp`
2. Implement Phase 1 (Foundation)
3. Add contract tests in parallel
4. Daily smoke tests using the 10-minute plan
5. PR for review (not direct merge)

---

This plan incorporates all expert feedback and provides a clear path to production-ready implementation.