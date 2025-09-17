# Unified Canvas Nodes & Camera Pan — Implementation Tracking

**Feature Slug:** unified_components
**Status:** Implementation in progress
**Date Started:** 2025-09-16
**Focus:** Option A (offline mode, no Yjs runtime)

## Overview

Implementing camera-based panning system to unify positioning behavior between panels and component widgets, addressing the current issue where panels are heavier and desync during drag/pan operations.

## Scope

Based on `camera-pan-unified-nodes-plan.md`:
- Phase 1: Quick wins (simplify drag, unify z-index, defer TipTap)
- Phase 2: Camera POC validation
- Phase 3: Camera migration with feature flags
  - Z-Index tokens
  - Camera-based edge pan
  - Pointer-friendly overlays
  - Intent-based layer switching

## Acceptance Criteria

- [ ] Panels and components use same drag/positioning logic
- [ ] Camera-based pan replaces DOM manipulation
- [ ] Feature flag allows instant rollback
- [ ] All tests pass (lint, type-check, integration)
- [ ] Drop accuracy maintained at all zoom levels
- [ ] Performance metrics show improvement or parity

## ATTEMPT HISTORY

### Attempt 1 - 2025-09-16
- Starting implementation following phased approach
- Creating feature workspace structure
- Beginning with Phase 1 quick wins
- Completed Phase 1: Simplified drag state, unified z-index tokens, added TipTap defer mechanism
- Completed Phase 2: Built camera POC test component
- Completed Phase 3: Added camera-based edge pan with feature flag support
- Implementation complete, enabled by default (set NEXT_PUBLIC_CANVAS_CAMERA=0 to opt out during verification)

## ERRORS

None yet - implementation just starting.

## Commands for Testing

```bash
# Validation gates
npm run lint
npm run type-check
npm run test

# Feature flag testing
npm run dev  # camera path active by default

# Integration
docker compose up -d postgres
npm run test:integration
```
