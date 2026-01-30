# Full Project Knowledge — Chat Navigation & Annotation System

**Purpose:** This document captures the complete understanding of the project so that any future session can immediately get up to speed without re-reading dozens of files. It covers architecture, the chat navigation system we are actively working on, the clarification/disambiguation subsystem in detail, every fix applied, and the current state of work.

**Last Updated:** 2026-01-29 18:49 MST

---

## Table of Contents

1. [What This Project Is](#1-what-this-project-is)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Architecture](#4-architecture)
5. [The Chat Navigation System (What We Work On)](#5-the-chat-navigation-system)
6. [Plan Hierarchy (Critical to Understand)](#6-plan-hierarchy)
7. [The Clarification / Disambiguation Subsystem (Deep Dive)](#7-the-clarification--disambiguation-subsystem)
8. [The Routing Flow (Step by Step)](#8-the-routing-flow)
9. [The Snapshot Lifecycle](#9-the-snapshot-lifecycle)
10. [Three-Tier Return-Cue Detection](#10-three-tier-return-cue-detection)
11. [All Fixes Applied (2026-01-29 Session)](#11-all-fixes-applied)
12. [Debug Logging & Telemetry](#12-debug-logging--telemetry)
13. [Feature Flags](#13-feature-flags)
14. [QA Checklist](#14-qa-checklist)
15. [Known Limitations & Open Issues](#15-known-limitations--open-issues)
16. [Key File Reference](#16-key-file-reference)
17. [How to Investigate Issues](#17-how-to-investigate-issues)
18. [What to Do Next](#18-what-to-do-next)

---

## 1. What This Project Is

This is a **Dual-Mode Annotation System** — a knowledge management tool with:

- **Canvas-based UI**: Draggable, zoomable panels on an infinite canvas
- **Branch-based annotations**: note, explore, promote workflows
- **Rich text editing**: TipTap-powered editor
- **Chat navigation panel**: Natural language interface for navigating, retrieving docs, opening panels, and disambiguating user intent
- **Organization tree**: Hierarchical folder/note structure rooted at `/knowledge-base`

The system runs in two modes:
- **Option A (current)**: Offline, single-user, PostgreSQL-only. No Yjs runtime.
- **Option B (future)**: Multi-user, real-time collaboration with Yjs CRDTs over WebSocket/WebRTC.

The schemas are designed to be compatible with Option B, but Option A does not implement any Yjs or CRDT logic.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.2.4, React 19 |
| Language | TypeScript 5 (strict) |
| Editor | TipTap 2.14.0 |
| Database | PostgreSQL (remote primary, local failover for Electron) |
| UI | Radix UI, Tailwind CSS, Framer Motion |
| Icons | Lucide |
| Forms | React Hook Form + Zod |
| LLM | Google Generative AI (Gemini Flash), OpenAI SDK (GPT-4o-mini) |
| Desktop | Electron (with IPC bridge) |
| Testing | Jest (unit), Playwright (E2E), PostgreSQL (integration) |
| Collab (future) | Yjs, y-websocket, y-webrtc |

---

## 3. Project Structure

```
annotation-backup/
├── app/                    # Next.js App Router (pages + API routes)
│   ├── api/                # API routes
│   │   ├── chat/           # Chat navigation APIs (clarification LLM, return-cue)
│   │   ├── docs/           # Doc retrieval API
│   │   ├── retrieve/       # Unified retrieval API (docs + notes)
│   │   ├── items/          # Items CRUD
│   │   ├── debug/          # Debug logging API
│   │   ├── telemetry/      # Telemetry API
│   │   └── ...             # annotations, canvas, dashboard, panels, etc.
│   └── page.tsx            # Root page
├── components/             # React UI components (~113 component groups)
│   ├── canvas/             # Infinite canvas, draggable panels
│   ├── chat/               # Chat navigation panel UI
│   ├── editor/             # TipTap editor integration
│   ├── sidebar/            # Navigation sidebar
│   ├── toolbar/            # Floating toolbar
│   └── ...
├── lib/                    # Core logic (~55 modules)
│   ├── adapters/           # Data layer (postgres, offline, electron, web)
│   ├── chat/               # ★ Chat routing, clarification, query patterns
│   ├── docs/               # Doc retrieval, indexing, known terms
│   ├── database/           # Connection manager, migration runner
│   ├── sync/               # Conflict detection, hybrid sync
│   ├── providers/          # Yjs/plain-offline providers
│   └── utils/              # Debug logger, helpers
├── migrations/             # PostgreSQL migrations (134 files, up to 066)
├── electron/               # Electron main process + IPC
├── hooks/                  # Custom React hooks
├── __tests__/              # Unit + integration tests
├── e2e/                    # Playwright E2E tests
├── scripts/                # Build/deploy/utility scripts (~74)
├── docs/                   # Documentation
│   └── proposal/           # Feature workspaces (per CLAUDE.md convention)
│       └── chat-navigation/plan/panels/chat/meta/  # ★ All chat nav plans
├── codex/                  # Project context docs
├── fixes_doc/              # Previous fix documentation
└── CLAUDE.md               # ★ Authoritative project conventions (must-read)
```

---

## 4. Architecture

### Data Flow
```
User Input → Chat Navigation Panel UI
  → chat-navigation-panel.tsx (orchestrator)
    → chat-routing.ts (routing handlers, ~3800 lines)
      → clarification-offmenu.ts (deterministic detection)
      → clarification-llm-fallback.ts (LLM fallback)
      → query-patterns.ts (pattern matching utilities)
      → routing-telemetry.ts (telemetry events)
    → chat-navigation-context.tsx (shared state: messages, snapshots, clarification)
  → API routes (doc retrieval, LLM calls, debug logging)
  → PostgreSQL (persistence, debug logs)
```

### Platform Modes
- **Web**: Next.js Server Components + API routes → Remote PostgreSQL
- **Electron**: Compiled Next.js + Electron IPC → Local PostgreSQL (falls back to remote)

### Adapter Pattern
The project uses adapters to switch between platform/persistence modes:
- `lib/adapters/web-postgres-adapter.ts` — Web + Postgres
- `lib/adapters/electron-postgres-adapter.ts` — Electron + Postgres
- `lib/adapters/postgres-offline-adapter.ts` — Generic offline fallback
- No IndexedDB fallback. PostgreSQL-only.

---

## 5. The Chat Navigation System

This is the subsystem we are actively building and iterating on. It lives primarily in:

- `components/chat/chat-navigation-panel.tsx` — UI orchestrator
- `lib/chat/chat-routing.ts` — All routing handlers (~3800 lines)
- `lib/chat/chat-navigation-context.tsx` — Shared state (messages, snapshots, clarification state)

### What It Does

The chat navigation panel is a natural-language interface where users can:

1. **Ask about docs** → triggers doc retrieval from knowledge base
2. **Open panels/widgets** → triggers panel command routing
3. **Disambiguate** → when multiple results match, shows clarification pills
4. **Navigate cross-corpus** → docs vs notes disambiguation
5. **Resume interrupted flows** → return to previous clarification lists

### The Problem We Solve

When the system shows the user a clarification list (e.g., "Did you mean: A, B, or C?"), the user might:
- Pick an option (ordinal: "first one", or label: "option A")
- Say something off-menu ("show me the settings one")
- Get interrupted (new command mid-clarification)
- Want to stop ("stop", "cancel")
- Want to go back ("back to the options", "show me what I had before")
- Say something noisy ("asdf", "1", garbled text)

Each of these must be handled correctly without misrouting.

---

## 6. Plan Hierarchy (Critical to Understand)

Plans build on each other in layers. **Later plans override earlier ones where specified.** This is the reading order:

### Layer 1: Foundation (Doc Retrieval)
```
cursor-style-doc-retrieval-plan.md      → Keyword + chunk retrieval pipeline
general-doc-retrieval-routing-plan.md   → Routing v5 (HS1/HS2 selection, disambiguation pills)
2026-01-14-doc-retrieval-routing-debt-paydown-plan.md → Technical debt cleanup
unified-retrieval-prereq-plan.md        → Cross-corpus (docs + notes) prerequisites
```
All complete. These provide the retrieval infrastructure.

### Layer 2: Clarification (What We Actively Iterate On)
```
clarification-offmenu-handling-plan.md       ← BASE: Deterministic tiers
  ↓ builds on
clarification-llm-last-resort-plan.md        ← Constrained LLM fallback (feature-flagged)
  ↓ builds on
clarification-response-fit-plan.md           ← PRIMARY: Intent classifier, confidence ladder
  ├── clarification-interrupt-resume-plan.md ← ADDENDUM: Pause/resume on interruption
  └── clarification-stop-scope-plan.md       ← ADDENDUM: Scope-aware stop/cancel
```

### Layer 3: Command Routing Drafts (Pending)
```
panel-command-matcher-stopword-plan.md       ← Action‑verb stopword gate (await red‑error debug log)
known-noun-command-routing-plan.md           ← Noun‑only commands allowlist + unknown fallback
```

### Supporting Documents
```
clarification-offmenu-handling-examples.md   ← Canonical bot/user response wording
clarification-response-fit-implementation-guide.md ← Checklist-style implementation guide
clarification-qa-checklist.md                ← 13-test acceptance gate (A1-E13)
INDEX.md                                      ← Plan timeline and quick reference
```

### Key Rule: Addenda Override
`clarification-interrupt-resume-plan.md` and `clarification-stop-scope-plan.md` are addenda to the response-fit plan. Where they specify behavior, they take precedence over the base plans.

### App Documentation Source (Seeded into PostgreSQL)

The folder `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/` contains the **app knowledge base** — short, focused docs that get seeded into PostgreSQL for the chat retrieval system. When a user asks "what is the dashboard?" or "how do widgets work?", the retrieval pipeline pulls from these seeded docs.

**Structure:**
```
documentation/
├── README.md              ← Style rules, seeding process
├── glossary.md            ← Short definitions of common terms
├── concepts/              ← Core app concepts (11 files)
│   ├── home.md
│   ├── dashboard.md
│   ├── entry.md
│   ├── workspace.md
│   ├── notes.md
│   ├── widgets.md
│   ├── panels.md
│   ├── canvas.md
│   ├── floating-toolbar.md
│   ├── chat-assistant.md
│   └── annotations.md
├── widgets/               ← Built-in widget descriptions (10 files)
│   ├── recent.md
│   ├── quick-links.md
│   ├── links-panel.md
│   ├── navigator.md
│   ├── continue.md
│   ├── widget-manager.md
│   ├── links-overview.md
│   ├── quick-capture.md
│   ├── demo-widget.md
│   └── category-navigator.md
└── actions/               ← Supported user actions (4 files)
    ├── navigation.md
    ├── notes.md
    ├── widgets.md
    └── workspaces.md
```

**How seeding works:**
- These markdown files map to the DB seeding plan and retrieval phases
- Each file is a small, scoped explanation the LLM/retrieval can reuse
- The seeding process uses `content_hash` to detect changes — updating a file triggers a DB update
- Seeded via `lib/docs/seed-docs.ts` into the `docs_knowledge` / `docs_knowledge_chunks` tables
- Retrieved via `lib/docs/keyword-retrieval.ts` and the `/api/docs/retrieve` endpoint

**Why this matters for clarification:**
When the chat routing system cannot match user input to a panel command or clarification option, it falls through to **doc retrieval**. The retrieval system searches these seeded docs. If "back pls" incorrectly falls through (as it did before our fix), the system would try to find a doc matching "back pls" — which is why the user saw unrelated doc results instead of their paused list being restored.

---

## 7. The Clarification / Disambiguation Subsystem (Deep Dive)

### Core Concept: Clarification State Machine

When the system can't resolve a user's query to a single action, it enters **clarification mode**:

1. Shows options as pills (e.g., "Recent Panel", "Workspace Panel", "Links Panel")
2. Sets `lastClarification` state with the options, type, and original intent
3. All subsequent user input goes through the **clarification intercept** in `chat-routing.ts`
4. The intercept classifies the input and either:
   - Resolves to an option (execute)
   - Asks for clarification (re-show/refine)
   - Detects a new topic (exit clarification, route normally)
   - Handles special intents (stop, back, noise, hesitation)

### Clarification Types

```typescript
type ClarificationType =
  | 'notes_scope'           // Scoping query to notes
  | 'option_selection'      // Multi-choice panel/command disambiguation
  | 'doc_disambiguation'    // Multiple docs match
  | 'td7_high_ambiguity'    // High-ambiguity doc/LLM choice
  | 'cross_corpus'          // Docs vs Notes disambiguation
  | 'panel_disambiguation'  // Multiple panels match
  | 'workspace_list'        // Workspace selection
```

### Deterministic Detection Functions (clarification-offmenu.ts)

| Function | Purpose |
|----------|---------|
| `mapOffMenuInput()` | Map free-text to an option via canonical token matching |
| `detectNewTopic()` | Check if input is a new command/question unrelated to options |
| `classifyResponseFit()` | Master intent classifier (short hint, map, ambiguity, new topic) |
| `detectReturnSignal()` | Detect "back", "return", "show those again" patterns |
| `isExitPhrase()` | Detect "stop", "cancel", "nevermind" |
| `classifyExitIntent()` | Classify exit as explicit vs ambiguous |
| `isHesitationPhrase()` | Detect "hmm", "not sure", "idk" |
| `isRepairPhrase()` | Detect "the other one", "not that one" |
| `isListRejectionPhrase()` | Detect "none of these", "neither" |
| `isNoise()` | Detect garbled input, keyboard smash, emoji-only |
| `toCanonicalTokens()` | Normalize input (lowercase, remove stopwords, apply micro-aliases) |

### Confidence Thresholds

```typescript
CONFIDENCE_THRESHOLD_EXECUTE = 0.75  // Auto-select without confirmation
CONFIDENCE_THRESHOLD_CONFIRM = 0.55  // Show confirmation before executing
```

### classifyResponseFit() Decision Tree

This is the **core function** that determines what happens with user input during clarification:

```
Input → trimmedInput, options[], clarificationType

1. SHORT HINT CHECK (≤2 tokens)
   - If not exact label and not clear command
   - Check partial overlap with options
   → ask_clarify (confidence 0.2-0.5)

2. MAP OFF-MENU INPUT (deterministic matching)
   - Canonical equality (tokens match exactly) → select (0.85)
   - Canonical subset (input tokens ⊂ label tokens) → select (0.65)
   - Multiple matches → ambiguous

3. AMBIGUOUS RESULT
   - Find partial-match candidates
   → soft_reject (0.4)

4. PARTIAL OVERLAP + EXTRA TOKENS
   - Some tokens match, some don't
   → soft_reject (0.35)

5. NEW TOPIC DETECTION
   - Clear command/question + non-overlapping tokens
   → new_topic (0.8)

6. FALLBACK
   → ask_clarify (0.2)
```

### LLM Fallback (clarification-llm-fallback.ts)

Two LLM endpoints:

1. **`callClarificationLLMClient()`** — Selection LLM (GPT-4o-mini)
   - Triggers after deterministic matching fails
   - Decisions: `select | none | ask_clarify | reroute | repair | reject_list`
   - 800ms timeout via AbortController
   - Feature-flagged: `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK`

2. **`callReturnCueLLM()`** — Return-cue LLM (Gemini Flash)
   - Triggers when user might want to resume a paused list
   - Decisions: `return | not_return`
   - 800ms timeout
   - Route: `/api/chat/clarification-llm/return-cue`

### Escalation Messaging Policy

When user gives off-menu input repeatedly:
- **Attempt 1**: "I didn't catch that. Reply first or second..."
- **Attempt 2**: "Which one is closer?" + exit pills
- **Attempt 3+**: "Tell me in 3-6 words" + exit pills

---

## 8. The Routing Flow (Step by Step)

When a user sends a message, `handleClarificationIntercept()` in `chat-routing.ts` processes it in this **strict order**:

### Phase 1: Pre-Clarification Guards
1. **Reset stop suppression** counter on non-exit input
2. **Early repair memory** — check for "the other one" even after clarification clears
3. **Post-action repair window** — if user says "not that" and snapshot exists (not paused)

### Phase 2: Paused Snapshot Recovery (Interrupt-Resume)
4. **Affirmation check** — if user says "yes" with paused snapshot → restore list
5. **Deterministic return cue** — `detectReturnSignal()` for "back", "show those again"
6. **Compound input** — "back to panels — second option" (return cue + ordinal)
7. **LLM return-cue fallback** — `callReturnCueLLM()` if deterministic fails
8. **Tier 3 confirm** — if LLM fails: "Do you want to go back to the previous options?"
9. **Paused-snapshot repair guard** — absorb "not that" after interrupt

### Phase 3: Post-Action Ordinal Window
10. **Selection persistence** — ordinals resolve against active/paused snapshots
11. **Stop-paused ordinal guard** — if `pausedReason === 'stop'`, block ordinals

### Phase 4: Stop Scope (No Active Clarification)
12. **Exit phrases without active list** — pause snapshot, set suppression counter
13. **Bare ordinal detection** — ask what list user means

### Phase 5: Snapshot Turn Counter
14. **Increment snapshot turn** (no automatic expiry per plan)

### Phase 6: Active Clarification Mode
15. **Noise pre-check** — `isNoise()` for garbled/short/emoji input
16. **List rejection** — "none of these" → Refine Mode
17. **Exit phrase detection** — explicit vs ambiguous exit
18. **Hesitation** — "hmm", "not sure" → softer prompt, no attemptCount increment
19. **Affirmation/rejection** — "yes" → execute, "no" → escalate, repair → auto-select
20. **Label matching** — strip command verbs, match against option labels
21. **Response-fit classifier** — `classifyResponseFit()` master decision
22. **LLM fallback** — `callClarificationLLMClient()` if deterministic fails
23. **Escalation messaging** — attempt-based prompts with exit pills

---

## 9. The Snapshot Lifecycle

The **ClarificationSnapshot** is the mechanism that allows users to resume a previous clarification list after being interrupted or stopping.

### State Transitions

```
1. User asks ambiguous query
   → System shows clarification pills
   → saveClarificationSnapshot(clarification, paused=false)

2. User sends "stop" (ambiguous stop)
   → System asks: "End this or start over?"
   → User confirms exit
   → pauseSnapshotWithReason('stop')
   → "All set — what would you like to do?"

3. User sends a new command mid-clarification (interrupt)
   → System detects new topic
   → pauseSnapshotWithReason('interrupt')
   → Executes the new command

4. User says "back to the options" (return cue)
   → detectReturnSignal() matches
   → Restore paused list as active clarification
   → clearClarificationSnapshot()

5. User says "yes" after Tier 3 confirm prompt
   → isAffirmationPhrase() matches
   → Restore paused list
   → clearClarificationSnapshot()
```

### Key Rules

- **No automatic expiry**: Paused snapshots persist across unrelated commands until explicit exit or replacement (per plan §144).
- **Stop-paused snapshots block ordinals**: `pausedReason === 'stop'` means "first option" won't resolve — requires explicit return cue.
- **Interrupt-paused snapshots allow ordinals**: `pausedReason === 'interrupt'` means ordinals still work against the paused list.
- **Turn counter increments but doesn't expire**: `incrementSnapshotTurn()` updates `turnsSinceSet` for telemetry but doesn't trigger expiry.

### ClarificationSnapshot Interface

```typescript
interface ClarificationSnapshot {
  options: ClarificationOption[]     // The clarification options
  originalIntent: string             // Query that created the clarification
  type: LastClarificationState['type']
  turnsSinceSet: number              // Counter (no expiry)
  timestamp: number
  paused?: boolean                   // true if interrupted/stopped
  pausedReason?: 'interrupt' | 'stop'
}
```

---

## 10. Three-Tier Return-Cue Detection

When a user has a **paused snapshot** and sends input, the system tries to detect if they want to return to the paused list:

### Tier 1: Deterministic (detectReturnSignal)

Regex patterns in `clarification-offmenu.ts`:

```
"back to the panels/options/list"
"back to <specific label>"
"take me/them back (again)"
"continue/resume that/the list/options"
"continue/resume choosing/selecting"
"the other one from before"
"from before/earlier"
"show those options again / bring those back"
"put it/them/those back"
"show me what I had before"
"previous/earlier/last options/list"
Standalone: "back", "return", "resume", "continue"
```

**Politeness stripping**: Before matching, strips trailing `pls|please|thanks|thx|ty` so "back pls" → "back" → matches standalone pattern.

**Standalone back rule (paused list only):** If a paused list exists, a single-word `back` / `go back` is a valid return cue and must restore the list (no routing).

### Tier 2: LLM (callReturnCueLLM)

If Tier 1 fails, calls Gemini Flash via `/api/chat/clarification-llm/return-cue/`:
- Sends user input + context about paused list
- Returns `{ decision: 'return' | 'not_return', confidence, reason }`
- 800ms timeout

**Guards before calling LLM**:
- Feature flag must be enabled
- Input must not be a repair phrase ("the other one")
- Input must not be an ordinal ("first option", "second one")

### Tier 3: Confirm Prompt

If LLM fails (timeout, error, or 429 rate limit):
- Shows: "Do you want to go back to the previous options?"
- If user says "yes" → restore paused list
- Returns `{ handled: true }` — **never falls through to doc routing**

---

## 11. All Fixes Applied

### Session: 2026-01-29

**Bug:** "back pls" (and similar natural-language return cues with trailing politeness) fell through all three detection tiers and routed to unrelated doc retrieval instead of restoring the paused clarification list.

#### Fix 1: Strip trailing politeness before return-cue regex
**File:** `lib/chat/clarification-offmenu.ts` (detectReturnSignal, ~line 516-565)
- Added `stripped` variable: `normalized.replace(/\s+(pls|please|thanks|thx|ty)$/i, '').trim()`
- Matching loop tries stripped first, then normalized

#### Fix 2: Added "put it/them/those back" deterministic pattern
**File:** `lib/chat/clarification-offmenu.ts` (~line 543)
- Added `\bput\s+(it|them|those)\s+back\b` to the return-cue regex list

#### Fix 3: Skip return-cue LLM for ordinals
**File:** `lib/chat/chat-routing.ts` (~line 1675-1681)
- Added `isOrdinalInput` guard before `callReturnCueLLM()`
- Prevents ordinals like "first option" from triggering unnecessary LLM calls
- This was causing Gemini 429 rate limiting

#### Fix 4: Tier 3 confirm prompt on LLM failure
**File:** `lib/chat/chat-routing.ts` (~line 1766-1810)
- Replaced silent fallthrough with confirm prompt: "Do you want to go back to the previous options?"
- Both failure and catch branches return `{ handled: true }`

#### Fix 5: Affirmation handling for Tier 3 recovery
**File:** `lib/chat/chat-routing.ts` (~line 1583-1628)
- Added `isAffirmationPhrase()` check at top of paused-snapshot block
- "yes" with paused list → restore with pausedReason-aware messaging

#### Fix 6: Expanded deterministic return cues (late 2026-01-29)
**File:** `lib/chat/clarification-offmenu.ts` (detectReturnSignal)
- Added "show me what I had before".
- Clarified standalone `back` as a valid return cue when a paused list exists.

### Continued Session: 2026-01-29 ~14:00–18:49 MST

#### Fix 7: `data: {} as SelectionOption['data']` patch (16 spots)
**File:** `lib/chat/chat-routing.ts`
- When re-displaying clarification options (noise, hesitation, soft-reject, exit-cancel, repair, etc.), `data` was `{} as SelectionOption['data']` because `ClarificationOption` has no `data` field.
- Replaced all 16 occurrences with `reconstructSnapshotData(opt)` which rebuilds `data` from `id/label/type` (handles panel_drawer, doc, note, workspace, entry types).
- Prevents "Opening undefined..." errors on pill clicks.

#### Fix 8: bare_ordinal_no_context message update
**File:** `lib/chat/chat-routing.ts` (line ~2062)
- Updated unhelpful "Which options are you referring to?" message to include recovery guidance: `"Which options are you referring to? If you meant a previous list, say 'back to the options', or tell me what you want instead."`

#### Fix 9: Save clarification snapshot on pill click (handleSelectOption)
**File:** `components/chat/chat-navigation-panel.tsx`
- `handleSelectOption()` cleared `lastClarification` without saving a snapshot. The stop/return-cue system had nothing to restore after pill-click selections.
- Added `saveClarificationSnapshot(lastClarification)` before clearing, guarded by `options.length > 0 && option.type !== 'exit'`.

#### Fix 10: Return-cue candidate allowlist guard
**File:** `lib/chat/chat-routing.ts` (lines ~1740-1745)
- Fix 9 caused a regression: paused snapshots now existed after pill clicks, so every non-ordinal/non-repair input entered the return-cue LLM (which always timed out), creating a "Do you want to go back?" confirm-prompt loop.
- Added allowlist: only inputs containing return-related tokens (`back|return|resume|continue|previous|old|earlier|before|again|options|list|choices`) enter the LLM path. All other inputs fall through to normal routing.

#### Debug enhancement: `api_response_not_ok` log
**File:** `components/chat/chat-navigation-panel.tsx`
- Added `api_response_not_ok` debug log at the `!response.ok` throw point, capturing: input, HTTP status, statusText, response body (first 500 chars).
- Enhanced existing `sendMessage_error` log to also include the input.
- Purpose: diagnose the "Something went wrong" red error for "open links panel" after stop.

### Open Investigation: "open links panel" red error after stop

**Symptom:** After stop, "open links panel" shows red "Something went wrong. Please try again." error. Other commands like "open recent" work fine.

**Confirmed findings (via debug_logs):**
1. Panel disambiguation skipped — `normalizeToTokenSet()` doesn't strip action verbs ("open") → zero matches for multi-word panel titles.
2. Falls through to `/api/chat/navigate` LLM API → 8-second timeout (504). Verified by exact 8s gap in debug log timestamps.
3. "open recent" works because "Recent" is a single-word title → exact match succeeds even with "open" in tokens.

**Planned fix:** Add action verbs to `STOPWORDS` in `panel-command-matcher.ts`. Plan documented in `panel-command-matcher-stopword-plan.md`. Awaiting reproduction with new debug logs to confirm before implementing.

---

## 12. Debug Logging & Telemetry

### How Debug Logging Works

- Client code calls `debugLog()` from `lib/utils/debug-logger.ts`
- This hits `/api/debug/log` API route
- Logs are stored in PostgreSQL `debug_logs` table
- Query via Docker: `docker exec -i annotation-postgres psql -U postgres -d annotation_dev`

### Key Telemetry Events

| Event | When |
|-------|------|
| `paused_list_return_signal` | Tier 1 deterministic match — immediate restore |
| `paused_return_llm_called` | Tier 2 LLM called |
| `paused_return_llm_return` | Tier 2 LLM says "return" |
| `paused_return_llm_not_return` | Tier 2 LLM says "not_return" |
| `paused_return_llm_failed` | Tier 2 LLM failed/timed out |
| `paused_return_llm_error` | Tier 2 LLM threw exception |
| `paused_list_affirmation_return` | Tier 3: user said "yes" → restored |
| `stop_paused_ordinal_blocked` | Ordinal blocked (pausedReason='stop') |
| `clarification_tier1a_exit_confirm` | Ambiguous exit confirm shown |
| `clarification_tier_noise_detected` | Garbled/noise input detected |
| `clarification_response_fit` | Response-fit classifier result |

### How to Query Debug Logs

```bash
docker exec -i annotation-postgres psql -U postgres -d annotation_dev -c "
  SELECT created_at, action, metadata::text
  FROM debug_logs
  WHERE component = 'ChatNavigation'
  ORDER BY created_at DESC
  LIMIT 20;
"
```

---

## 13. Feature Flags

| Flag | Scope | Purpose |
|------|-------|---------|
| `CLARIFICATION_LLM_FALLBACK` | Server (.env) | Enable LLM fallback for clarification |
| `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK` | Client (env) | Client-side gate for LLM fallback |
| `CLARIFICATION_LLM_MODEL` | Server | Model selection for LLM calls |
| `NEXT_PUBLIC_CROSS_CORPUS_FUZZY` | Client | Cross-corpus fuzzy normalization |
| `SEMANTIC_FALLBACK_ENABLED` | Server | Semantic fallback classifier for routing |

---

## 14. QA Checklist

The `clarification-qa-checklist.md` defines **13 manual tests** (A1-E13) that must pass before a clarification change is considered complete:

### Group A: Stop/Cancel
- **A1**: Stop during clarification (ambiguous) → confirm prompt
- **A2**: Stop during clarification (explicit "cancel this") → immediate exit
- **A3**: Stop with no active list → "No problem..."
- **A4**: Repeated stop → suppression for 2 turns
- **A5**: Bare ordinal after stop → "That list was closed..."

### Group B: Interrupt/Resume
- **B6**: Interrupt executes immediately (new command mid-clarification)
- **B7**: Ordinal after interrupt (implicit return) → resolves from paused list
- **B8**: Explicit return resumes ("back to the options")
- **B9**: Repair after interrupt ("the other one")
- **B9b**: Return cue variants ("pls take it back", "i want to go back")
- **B9c**: Return-cue LLM fallback → Tier 3 confirm → "yes" → restores

### Group C: Selection
- **C10**: Multiple ordinals while list visible → each resolves correctly

### Group D: Labels
- **D11**: Bare label without return cue → ???

### Group E: Edge Cases
- **E12**: Noise (garbled text, bare numbers) → noise prompt
- **E13**: Hesitation ("hmm", "not sure") → softer prompt

### Current Status (2026-01-29)
- **Passed**: A1, A2, A3, A4, A5, B6, B8, B9b, B9c, C10, E12 (11 tests)
- **Not tested**: B7, B9, D11, E13 (4 tests)

---

## 15. Known Limitations & Open Issues

### Active Issues

1. **Gemini LLM consistently times out at 800ms.** Every Tier 2 LLM call in test sessions failed with timeout. The Tier 3 confirm prompt catches this, but the LLM fallback (Tier 2) is effectively non-functional. Needs investigation — could be API key quota, Gemini Flash latency, or network issues.

2. **Restore logic duplicated.** The restore-paused-list logic exists in three places in `chat-routing.ts`: Tier 1 handler, Tier 2 handler, and affirmation handler. Should be extracted into a shared `restorePausedList()` helper.

3. **Remainder noise from non-standalone patterns.** E.g., "pls take it back" → remainder "pls". Harmless but could be cleaned up.

4. **4 QA tests not yet run**: B7 (ordinal after interrupt), B9 (repair after interrupt), D11 (bare label without return cue), E13 (hesitation).

5. **"open links panel" red error after stop (under investigation).** Action verbs ("open", "show") are not stripped in `panel-command-matcher.ts` tokenization, causing panel disambiguation to miss multi-word panel commands. Falls through to LLM API which times out at 8 seconds (504). Fix planned: add action verbs to STOPWORDS. Awaiting debug log confirmation before implementing.

### Deferred/Pending Work

5. **Response-fit classifier still iterating** — the primary classifier plan is active but ongoing.
6. **Unified Retrieval Phase 2 adoption** — infrastructure complete, broader integration pending.
7. **Embeddings (Phase 3)** — deferred until keyword retrieval success rate drops.
8. **TD-6 LLM intent extraction** — deferred until patterns prove too brittle.

---

## 16. Key File Reference

### Must-Read Files (Before Any Work)

| File | Why |
|------|-----|
| `CLAUDE.md` | Authoritative project conventions — rules, testing gates, honesty requirements |
| `docs/proposal/chat-navigation/plan/panels/chat/meta/INDEX.md` | Plan timeline and quick reference |
| `docs/proposal/chat-navigation/plan/panels/chat/meta/clarification-qa-checklist.md` | Acceptance gate for all clarification changes |

### Core Implementation Files

| File | Lines | Purpose |
|------|-------|---------|
| `lib/chat/chat-routing.ts` | ~3800 | All routing handlers (this is the main file you'll edit) |
| `lib/chat/clarification-offmenu.ts` | ~1100 | Deterministic detection (patterns, classifier, return signals) |
| `lib/chat/chat-navigation-context.tsx` | ~1100 | Shared state (snapshots, clarification state, messages) |
| `lib/chat/clarification-llm-fallback.ts` | ~530 | LLM fallback wrappers (selection + return-cue) |
| `lib/chat/query-patterns.ts` | ~400 | Pattern utilities (affirmation, rejection, meta, fuzzy) |
| `lib/chat/routing-telemetry.ts` | ~200 | Telemetry event definitions |
| `components/chat/chat-navigation-panel.tsx` | ~600 | UI orchestrator |

### API Routes

| Route | Purpose |
|-------|---------|
| `/api/chat/clarification-llm/return-cue` | Gemini Flash return-cue classification |
| `/api/docs/retrieve` | Doc retrieval |
| `/api/retrieve` | Unified retrieval (docs + notes) |
| `/api/debug/log` | Debug log persistence |

### Plan Documents

| File | Purpose |
|------|---------|
| `clarification-offmenu-handling-plan.md` | Base: deterministic tiers |
| `clarification-response-fit-plan.md` | Primary: intent classifier |
| `clarification-interrupt-resume-plan.md` | Addendum: pause/resume (§46-69 = return-cue) |
| `clarification-stop-scope-plan.md` | Addendum: stop/cancel scope |
| `clarification-offmenu-handling-examples.md` | Canonical response wording |

---

## 17. How to Investigate Issues

### Step 1: Read the Plan
Identify which plan section governs the behavior. The plan hierarchy (Section 6) tells you where to look.

### Step 2: Read the Code
The routing flow (Section 8) tells you the exact order of handlers. Find the relevant phase/tier.

### Step 3: Check Debug Logs
```bash
docker exec -i annotation-postgres psql -U postgres -d annotation_dev -c "
  SELECT created_at, action, metadata::text
  FROM debug_logs
  WHERE component = 'ChatNavigation'
    AND created_at > NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC;
"
```

### Step 4: Trace the Snapshot
If the issue involves paused lists / return signals, trace the snapshot lifecycle:
- Was `saveClarificationSnapshot()` called?
- Was `pauseSnapshotWithReason()` called? With what reason?
- Is the snapshot still present when the return cue fires?
- What does `detectReturnSignal()` return for the input?

### Step 5: Check Feature Flags
If LLM-related, verify flags are enabled in `.env` and `.env.local`.

### Step 6: Validate with Type-Check
```bash
npx tsc --noEmit
```

---

## 18. What to Do Next

### Immediate (This Feature)
1. **Reproduce red error with new debug logs** — trigger “open links panel” after stop, check `api_response_not_ok` for HTTP status/body confirmation
2. **Gate action‑verb stopword fix on logs** — implement only if logs confirm verb commands fall into LLM path (`panel-command-matcher-stopword-plan.md`)
3. **Implement known‑noun command routing** — allowlist + unknown‑noun fallback (`known-noun-command-routing-plan.md`)
4. Investigate Gemini timeout issue — Tier 2 calls sometimes time out at 800ms
5. Run remaining QA tests: B7, B9, D11, E13
6. Refactor restore logic into shared `restorePausedList()` helper
7. Commit current changes

### Short Term
7. Continue response-fit classifier iteration
8. Address any new edge cases discovered during QA

### Medium Term
7. Begin Unified Retrieval Phase 2 adoption after response-fit stabilizes
8. Consider Embeddings (Phase 3) if keyword retrieval success rate drops

---

## Appendix: Implementation Reports

All reports live under `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/`:

| Date | Report | Scope |
|------|--------|-------|
| 2026-01-10 | cursor-style-doc-retrieval | Foundation |
| 2026-01-11 | phase2-chunk-retrieval | Chunk retrieval |
| 2026-01-11 | general-doc-retrieval-routing-complete | Routing v5 |
| 2026-01-14 | definitional-query-fix | Definitional fix |
| 2026-01-14 | td3-implementation | Debt TD-3 |
| 2026-01-15 | knownterms-race-fix | knownTerms race |
| 2026-01-15 | td2-fuzzy-matching | Debt TD-2 |
| 2026-01-15 | td4-td8-implementation | Debt TD-4, TD-8 |
| 2026-01-16 | td7-implementation | Debt TD-7 |
| 2026-01-19 | interface-weak-match-fix | Interface weak-match |
| 2026-01-20 | classifier-gemini-and-alias-coverage | Classifier Gemini + alias |
| 2026-01-20 | unified-retrieval-prereq-indexing | Prereq 1 |
| 2026-01-20 | unified-retrieval-prereq-permissions-workspace-scope | Prereq 2 |
| 2026-01-20 | prereq4-cross-corpus-ambiguity | Prereq 4 |
| 2026-01-20 | prereq5-safety-fallback | Prereq 5 |
| 2026-01-25 | clarification-offmenu-handling | Off-menu handling |
| 2026-01-29 | return-cue-fix | Return-cue fix (latest) |
