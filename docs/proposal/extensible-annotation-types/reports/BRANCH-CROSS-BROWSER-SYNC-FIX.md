# ⚠️ Deprecated: Branch Panel Cross-Browser Sync Fix (Superseded)

> **Status**: **Deprecated / Do Not Implement**  
> **Reason**: Subsequent analysis (`CRITIQUE-ANALYSIS-BRANCH-SYNC-FIX.md`) shows that the plan below relies on incorrect assumptions (e.g., when `loadDocument` populates the cache, when `document:remote-update` fires, and how stale saves are prevented by the API). Implementing these steps would introduce regressions without resolving the root issue.
>
> **Next Steps**:  
> * Discard the implementation steps in this document.  
> * Re-investigate the true failure mode (stale snapshot being re-saved before the fresh load completes vs. lack of cross-tab refresh) with accurate instrumentation.  
> * Draft a new fix plan aligned with verified behaviour—preserving snapshot/offline UX while preventing premature saves—before touching production code.

---

# Review Summary (2025-10-10)

- **Decision**: **Reject implementation** described in this document.  
- **Why**: The original proposal misread the provider load flow, underestimated existing conflict safeguards, and would have broken snapshot-dependent UX.  
- **Action**: Treat the content below as historical context only; do **not** implement the listed steps.

---

## Key Findings

1. **Provider hydration happens before the promise resolves**  
   `loadDocument` writes into `documents`/`documentVersions` inside its `then` chain (`lib/providers/plain-offline-provider.ts:452-509`). Any guard that tries to inspect `getDocumentVersion` *before* that promise resolves will always see `0` and conclude the provider is empty.

2. **Server already rejects stale writes**  
   The API throws `stale document save: baseVersion …` (409) when an outdated payload arrives (`app/api/postgres-offline/documents/route.ts:60-119`). The database is not silently overwritten by snapshot fallback.

3. **`document:remote-update` is conflict-only**  
   The event is emitted in `refreshDocumentFromRemote` during conflict recovery (`lib/providers/plain-offline-provider.ts:630-736`). Wiring initial hydration or cross-tab refresh to it would have no effect.

4. **Snapshots power offline UX and previews**  
   Removing `originalText`/`content` from the snapshot preload would leave branch cards and tooltips blank (`components/canvas/branch-item.tsx`, `components/canvas/annotation-tooltip.ts`) and remove the offline fallback that Option A relies on.

5. **Root cause still needs verification**  
   The precise reason a second browser sometimes shows stale content (UI not re-rendering after hydration, pending autosave order, conflict handling) remains unconfirmed. This document did not supply correct evidence.

---

## Why the Original Plan Was Rejected

| Original assumption | Reality | Result |
|---------------------|---------|--------|
| Version check before snapshot restore will skip stale data | Provider cache is still empty at that moment | Guard never fires; snapshot remains |
| Snapshot fallback overwrites DB | Server rejects stale payloads with 409 | Claim incorrect |
| Listening to `document:remote-update` refreshes tabs on load | Event fires only after conflicts | Listener would do nothing |
| Removing snapshot content is harmless | Breaks offline mode and immediate previews | Significant UX regression |
| Added suppress/guard logic reduces risk | Increases complexity without verified benefit | Not justified |

---

## Recommended Path Forward

1. **Instrument both browsers**  
   Log provider version, cache contents, autosave payloads, and API responses to understand the real sequence when the bug reproduces.

2. **Validate UI refresh behaviour**  
   Confirm whether branch panels re-render with the provider’s hydrated content. If they do not, determine which state/event is missing.

3. **Design a targeted fix**  
   Once evidence is captured, propose the smallest change that keeps snapshot/offline behaviour intact while preventing premature saves (e.g., delaying autosave until after first successful load, explicitly forcing a panel refresh on resolved loads).

4. **Draft a fresh proposal**  
   Replace this deprecated report with a new, evidence-backed plan before implementing code changes.

---

## References

- `CRITIQUE-ANALYSIS-BRANCH-SYNC-FIX.md` – peer review that surfaced the inaccuracies.  
- `lib/providers/plain-offline-provider.ts` – authoritative load/save ordering.  
- `components/canvas/tiptap-editor-plain.tsx` – snapshot fallback and autosave implementation.  
- `app/api/postgres-offline/documents/route.ts` – conflict handling for document saves.

---

> _Historical plan removed:_ Earlier implementation instructions have been intentionally omitted to avoid accidental reuse. Treat this file solely as a rejection log until a corrected strategy is authored.
