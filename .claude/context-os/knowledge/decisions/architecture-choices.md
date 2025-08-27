# Architecture Decisions

## YJS + PostgreSQL Hybrid Approach
**Decision**: Use YJS for real-time collaboration, PostgreSQL for persistence
**Date**: 2024-08
**Status**: Implemented

### Context
- Need real-time collaboration (YJS excels here)
- Need queryable, persistent storage (PostgreSQL excels here)
- IndexedDB alone insufficient for server-side features

### Decision
Hybrid approach:
- YJS handles all real-time operations
- PostgreSQL stores structured data extracted from YJS
- Sync adapter pattern bridges the two

### Consequences
- **Good**: Best of both worlds - real-time + queryability
- **Good**: Can implement search, admin tools, analytics
- **Bad**: Complexity of dual systems
- **Bad**: Sync lag between YJS and PostgreSQL

### Alternatives Considered
1. **Pure YJS + IndexedDB**: Limited querying, no server-side features
2. **Pure PostgreSQL + Polling**: Poor real-time performance
3. **Redis + PostgreSQL**: Additional infrastructure complexity

---

## Adapter Pattern for Persistence
**Decision**: Use adapter pattern for all persistence operations
**Date**: 2024-07
**Status**: Active

### Context
- Multiple persistence targets (PostgreSQL, IndexedDB, potentially SQLite)
- Need to swap implementations without changing business logic
- Testing requires mock implementations

### Decision
All persistence through adapters:
```typescript
interface PersistenceAdapter {
  saveNote(note: Note): Promise<void>;
  loadNote(id: string): Promise<Note>;
  // etc...
}
```

### Consequences
- **Good**: Easy to test with mock adapters
- **Good**: Can support multiple platforms
- **Good**: Clear separation of concerns
- **Bad**: Additional abstraction layer
- **Bad**: Potential for leaky abstractions

---

## TipTap for Rich Text Editing
**Decision**: Use TipTap (ProseMirror wrapper) for editor
**Date**: 2024-06
**Status**: Active

### Context
- Need rich text editing with YJS support
- Must handle complex formatting and annotations
- Require extensibility for custom features

### Decision
TipTap because:
- First-class YJS integration
- Active development and community
- Good TypeScript support
- Extensible architecture

### Alternatives Considered
1. **Quill + YJS**: Less flexible, harder to extend
2. **Slate + YJS**: Less mature YJS integration
3. **Raw ProseMirror**: Too low-level, more work

---

## Canvas-based UI Architecture
**Decision**: Custom canvas implementation for spatial interface
**Date**: 2024-07
**Status**: Active

### Context
- Need draggable, zoomable panels
- Must support 1000s of panels efficiently
- Require smooth 60fps interactions

### Decision
Custom implementation using:
- React for panel contents
- DOM-based positioning (not HTML Canvas)
- CSS transforms for performance
- Virtualization for off-screen panels

### Consequences
- **Good**: Full control over behavior
- **Good**: Can optimize for our use case
- **Bad**: More code to maintain
- **Bad**: Browser compatibility concerns

### Alternatives Considered
1. **React Flow**: Too opinionated for our needs
2. **Konva/Fabric**: Canvas-based, harder to integrate React
3. **Native HTML Canvas**: Would require reimplementing React

---

## Event-driven Sync Architecture
**Decision**: Use event-driven architecture for YJS ↔ PostgreSQL sync
**Date**: 2024-08
**Status**: Implementing

### Context
- Need to sync changes without blocking UI
- Must handle failures gracefully
- Require eventual consistency

### Decision
Event-driven with queues:
```typescript
YJS Change → Event Queue → Sync Worker → PostgreSQL
                ↓
            IndexedDB (backup)
```

### Consequences
- **Good**: Non-blocking UI updates
- **Good**: Can batch updates for efficiency
- **Good**: Failure recovery built-in
- **Bad**: Eventual consistency complexity
- **Bad**: Need to handle out-of-order updates

---

## Migration Strategy
**Decision**: Incremental migration, not big bang
**Date**: 2024-08
**Status**: Active

### Context
- Existing code uses IndexedDB
- Can't break existing functionality
- Need to validate at each step

### Decision
Phases:
1. Add PostgreSQL alongside IndexedDB
2. Dual-write to both systems
3. Migrate read paths individually
4. Remove IndexedDB when stable

### Consequences
- **Good**: Lower risk
- **Good**: Can rollback easily
- **Good**: Validate with real usage
- **Bad**: Temporary complexity
- **Bad**: Longer migration timeline