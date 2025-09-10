# Test Results — Yjs Out of Bundle Patchset

Status: placeholder

Manual checks (to perform)
- Plain mode
  - [ ] Launch app with `NEXT_PUBLIC_COLLAB_MODE=plain`
  - [ ] Create/edit annotations; open panels; hover tooltips
  - [ ] Confirm no Yjs chunks in DevTools Network
  - [ ] Confirm no runtime Yjs warnings (except intentional guard logs)
- Yjs mode
  - [ ] Launch app with `NEXT_PUBLIC_COLLAB_MODE=yjs`
  - [ ] Verify collab editor chunk loads on demand
  - [ ] Confirm Y.Doc is provided via lazy loader; content syncs
  - [ ] Cursors visible (provider configured)

Automated (optional)
- [ ] Grep for `@/lib/yjs-provider` in components/ returns none
- [ ] Build plain mode and verify bundle analyzer (if available) shows no Yjs-related chunks

