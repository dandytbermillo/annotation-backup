# YJS Collaborative Annotation System - Core Context

## Project Overview
A real-time collaborative annotation system built with YJS (CRDT), featuring canvas-based interaction, PostgreSQL persistence, and multi-platform support (Web + Electron).

## Architecture
```
Frontend (React/Next.js 15)
    ↓
YJS Collaboration Layer (TipTap, Awareness)
    ↓
Sync Adapters (YJS ↔ PostgreSQL)
    ↓
PostgreSQL (Primary) + IndexedDB (Offline Fallback)
```

## Key Components
- **Canvas System**: Draggable, zoomable panels for notes/annotations
- **YJS Integration**: Real-time collaboration with CRDTs
- **Persistence**: PostgreSQL via sync adapters, IndexedDB for offline
- **Annotation Model**: Branch-based (note → explore → promote)

## Critical Conventions
1. **Adapter Pattern**: All persistence through `lib/adapters/*`
2. **YJS First**: Never bypass YJS for live operations
3. **Type Safety**: Strict TypeScript, no any types
4. **Testing Gates**: lint → type-check → test → integration → e2e

## Database Schema (PostgreSQL)
- `notes`: Core note storage with YJS doc references
- `annotations`: Anchored annotations with RelativePosition
- `panels`: Canvas positioning and state
- `snapshots`: YJS document snapshots for recovery
- `presence`: Ephemeral, not persisted

## Development Workflow
```bash
# Start local services
docker compose up -d postgres

# Run validation gates
npm run lint
npm run type-check
npm run test
npm run test:integration
npm run test:e2e

# Feature development
git checkout -b feat/feature-name
# Make changes following PRP process
# Validate at each step
```

## Current Focus Areas
1. PostgreSQL persistence layer (Phase 2B)
2. Structured data extraction from YJS
3. Admin interface for data management
4. Search functionality across notes

## Key Files & Paths
- Architecture: `docs/yjs-annotation-architecture.md`
- Workflows: `docs/annotation_workflow.md`
- Adapters: `lib/adapters/`, `lib/sync/`
- Components: `components/annotation-*.tsx`
- Database: `migrations/`, `lib/db.ts`

## Performance Targets
- Real-time sync: < 100ms latency
- Canvas operations: 60fps
- Search results: < 500ms
- Startup time: < 2s

## Security Considerations
- No secrets in code (use env vars)
- Sanitize all user input
- PostgreSQL prepared statements only
- Rate limit sync operations

## Platform Requirements
- Node.js 20.x
- PostgreSQL 15+
- Next.js 15
- YJS 13.x
- Modern browsers (Chrome 90+, Firefox 88+, Safari 14+)