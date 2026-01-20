# Unified Retrieval Prerequisites Plan

**Date:** 2026-01-19  
**Status:** Draft  
**Scope:** Notes/files indexing + permissions prerequisites (no implementation)  
**Related:** `general-doc-retrieval-routing-plan.md`

---

## Goal

Define the minimum prerequisites required before implementing unified retrieval
across docs + notes/files.

---

## Non‑Goals

- No retrieval logic changes.
- No UI changes.
- No embeddings rollout in this phase.

---

## Prerequisites Checklist

### 1) Indexing Strategy

- **Notes/files indexing approach**
  - Full‑text indexing (title + body)
  - Optional metadata fields (tags, modified_at, owner)
- **Schema hint**
  - Keep naming parallel to docs chunks (e.g., `notes_knowledge_chunks` or `items_chunks`)
- **Chunking rules**
  - Max chunk size (e.g., 500–900 chars)
  - Preserve headings/sections where possible
  - Extract TipTap/JSON → plain text before indexing
- **Refresh policy**
  - Trigger on create/update/delete
  - Background reindex for large batches

### 2) Permissions + Visibility

- **Access control rules**
  - Only show items the user can read
  - Enforce org/workspace boundaries
- **User scoping (critical)**
  - Notes/files queries must filter by `user_id`
  - Never return User A’s notes/files to User B
- **Server‑side filters**
  - Apply before scoring
- **Audit expectations**
  - Log access to private notes/files

### 3) Unified Retrieval API Contract

- **Single endpoint**
  - `POST /api/retrieve`
- **Request fields**
  - `corpus: "docs" | "notes" | "files" | "auto"`
  - `mode: "explain" | "search"`
  - `query`, optional `docSlug/resourceId`
  - `excludeChunkIds`, optional `cursor`
- **Response fields**
  - `docSlug`, `chunkId`, `header_path`
  - `isHeadingOnly`, `bodyCharCount`, `nextChunkId`
  - `corpus`, `score`, `status`

### 4) Cross‑Corpus Ambiguity UX

- If top candidates are from different corpora and close in score:
  - Show two pills (Docs vs Notes)
  - Require user confirmation before opening
- Corpus signal patterns:
  - “my notes”, “search notes”, “find in files” → notes/files corpus
  - Known doc terms → docs corpus

### 5) Safety + Fallback

- If notes/files index is unavailable:
  - Fall back to docs retrieval only
  - Or ask a clarifying question

---

## Acceptance Tests (Prereq Readiness)

1) Notes/files index exists and returns results with chunk metadata.
2) Permissions enforced server‑side (no leakage).
3) Query using `corpus=auto` returns docs vs notes with ambiguity pills when close
   (e.g., score_gap < MIN_GAP).
4) Missing notes index triggers fallback (no errors).

---

## Decision Gate

Unified Retrieval can start when **all** are true:

- Notes/files indexing implemented and stable.
- Permissions filter applied before scoring.
- Unified API contract agreed.
- Ambiguity UX defined.
