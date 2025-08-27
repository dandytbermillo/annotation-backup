# Quick Learnings & Notes

> This file captures quick learnings before they're organized into patterns/errors/decisions

## Recent Learnings

### 2024-08-24: YJS Binary Format
- YJS stores data in a special binary format that can't be parsed as JSON
- Must use Y.Doc methods like `getXmlFragment()`, `getMap()`, `getText()` to access data
- TipTap content is stored as Y.XmlFragment, not plain JSON

### 2024-08-24: PostgreSQL + YJS Sync
- Don't try to store YJS binary directly in JSONB columns
- Extract structured data from YJS first, then store
- Keep YJS binary in separate BYTEA column for recovery

### 2024-08-24: Context Window Management
- 8000 tokens is a good default limit for Claude
- Prioritize: current task (35%) > core context (25%) > knowledge (25%) > search (15%)
- Auto-archive completed tasks to keep context focused

### 2024-08-23: Testing YJS
- Mock Y.Doc for unit tests to avoid complex setup
- Integration tests need real YJS providers
- Use `Y.encodeStateAsUpdate()` for creating test fixtures

### 2024-08-23: Next.js 15 + YJS
- Disable SSR for components using YJS: `dynamic(() => import(...), { ssr: false })`
- YJS observers must be in useEffect, not during render
- Clean up observers in useEffect return function

## To Be Organized

- [ ] Connection pooling best practices for PostgreSQL
- [ ] Proper error boundaries for YJS failures  
- [ ] Performance profiling of large documents
- [ ] Conflict resolution strategies for offline-first
- [ ] Migration rollback procedures

## Quick Commands

```bash
# Check YJS document structure
node -e "const Y = require('yjs'); const doc = new Y.Doc(); console.log(doc.share);"

# Test PostgreSQL connection
psql postgresql://postgres:postgres@localhost:5432/claude_collaborative_annotations -c "SELECT version();"

# Profile YJS performance
NODE_OPTIONS='--inspect' npm run dev
# Then open chrome://inspect
```