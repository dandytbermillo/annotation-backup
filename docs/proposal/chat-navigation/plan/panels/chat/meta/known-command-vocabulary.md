# Known Command Vocabulary Reference

**Status:** Reference document (derived from source code)
**Purpose:** Complete inventory of recognized input patterns in the chat routing system.
**Last verified:** 2026-02-09

> This file documents what the routing system recognizes, not how it routes.
> For routing priority and tier ordering, see `routing-selection-rules-illustration.md`.

---

## 1) Action Verbs

Three overlapping verb sets serve different routing purposes.

### 1a) `isExplicitCommand` — Latch bypass (Rule 4)

**Source:** `lib/chat/input-classifiers.ts:34-37`

```
open, show, list, view, go, back, home, create, rename, delete, remove
```

Effect: bypasses focus latch. Input is treated as a new command, not a latched selection.
Exception: suppressed when ordinals are present (`first`, `second`, `1`, `2`, etc.).

### 1b) `COMMAND_START_PATTERN` — New-intent detection

**Source:** `lib/chat/query-patterns.ts:33`

```
open, show, go, list, create, close, delete, rename, back, home
```

Effect: triggers `isNewQuestionOrCommand`, which gates Tier 1b.4 fuzzy re-show and Tier 1b.5 new-intent escape.

### 1c) `ACTION_VERB_PATTERN` — Broad action detection

**Source:** `lib/chat/query-patterns.ts:43`

```
open, close, show, list, go, create, rename, delete, remove, add, navigate, edit, modify, change, update
```

Effect: used by `hasActionVerb` and `hasGraceSkipActionVerb` for grace-period command detection.

---

## 2) Canonicalizer Prefixes

**Source:** `lib/chat/input-classifiers.ts` — `canonicalizeCommandInput()`

Stripped before panel matching (Tier 2c) and known-noun matching (Tier 4). Longest-first matching; only one prefix stripped per input.

### Compound polite (verb embedded)

```
hey can you please open/show
hey can you pls open/show
hey could you please open/show
hey could you pls open/show
hey can you open/show
hey could you open/show
can you please open/show
can you pls open/show
could you please open/show
could you pls open/show
would you please open/show
would you pls open/show
```

### Simple polite (no verb)

```
can you please, can you pls
could you please, could you pls
would you please, would you pls
```

### Polite + verb (no "you")

```
please open/show
pls open/show
```

### Casual

```
hey open, hey show, hey
```

### Verb only

```
open, show, view, go to, launch
```

### Post-canonicalization

After prefix stripping, these are also removed:

- **Leading articles:** `the`, `a`, `an`
- **Trailing filler:** `pls`, `please`, `plz`, `thanks`, `thx`, `now`
- **Trailing punctuation:** `?`, `!`, `.`

### Examples

| Input | Canonicalized |
|-------|---------------|
| `can you open links panel pls` | `links panel` |
| `hey can you open the links panel` | `links panel` |
| `could you show the links panel please` | `links panel` |
| `open recent` | `recent` |
| `links panel` | `links panel` (no-op) |

---

## 3) Known Noun Targets (Tier 4)

**Source:** `lib/chat/known-noun-routing.ts:41-74` — `KNOWN_NOUN_MAP`

Deterministic panel-open by name. Input is canonicalized first, then matched against this map.

| Key | Panel ID | Title |
|-----|----------|-------|
| `recent` | `recent` | Recent |
| `recents` | `recent` | Recent |
| `recent items` | `recent` | Recent |
| `quick links` | `quick-links` | Quick Links |
| `quicklinks` | `quick-links` | Quick Links |
| `links` | `quick-links` | Quick Links |
| `links panel` | `quick-links` | Quick Links |
| `quick links a` | `quick-links-a` | Quick Links A |
| `quick links b` | `quick-links-b` | Quick Links B |
| `quick links c` | `quick-links-c` | Quick Links C |
| `quick links d` | `quick-links-d` | Quick Links D |
| `quick links e` | `quick-links-e` | Quick Links E |
| `links panel a` | `quick-links-a` | Links Panel A |
| `links panel b` | `quick-links-b` | Links Panel B |
| `links panel c` | `quick-links-c` | Links Panel C |
| `links panel d` | `quick-links-d` | Links Panel D |
| `links panel e` | `quick-links-e` | Links Panel E |
| `navigator` | `navigator` | Navigator |
| `demo` | `demo` | Demo |
| `widget manager` | `widget-manager` | Widget Manager |
| `quick capture` | `quick-capture` | Quick Capture |
| `links overview` | `links-overview` | Links Overview |

**Automatic suffix stripping:** `widget`, `panel` suffixes and `widget` prefix are stripped by `matchKnownNoun()`. So `recent widget`, `demo panel`, `widget demo` all resolve without explicit map entries.

---

## 4) Scope Cues

**Source:** `lib/chat/input-classifiers.ts:423-437` — `resolveScopeCue()`

### Chat scope (implemented)

```
back to options
from earlier options
from chat options
from the chat
from chat
in chat
```

Effect: overrides latch, restores chat executable context.

### Widget scope (deferred)

Not yet implemented. Future phase would match `from links panel d`, `from current widget`, etc.

---

## 5) Question Intent

**Source:** `lib/chat/query-patterns.ts:38` — `QUESTION_INTENT_PATTERN`

```
what, how, where, when, why, who, which, can, could, would, should, tell, explain, help, is, are, do, does
```

Also: any input ending with `?`.

Effect: blocks Tier 2c panel disambiguation **unless** the input also matches visible panel evidence (polite command override). Bypasses latch (Rule 4, question branch).

---

## 6) Affirmation Phrases

**Source:** `lib/chat/query-patterns.ts:18` — `AFFIRMATION_PATTERN`

```
yes, yeah, yep, yup, sure, ok, okay, k, ya, ye, yea, mhm, uh huh,
go ahead, do it, proceed, correct, right, exactly, confirm, confirmed
```

Optional trailing `please`. Effect: confirms pending action or clarification.

---

## 7) Rejection Phrases

**Source:** `lib/chat/query-patterns.ts:23` — `REJECTION_PATTERN`

```
no, nope, nah, negative, cancel, stop, abort, never mind, forget it,
don't, not now, skip, pass, wrong, incorrect, not that
```

Effect: rejects pending clarification or action.

---

## 8) Exit Phrases

**Source:** `lib/chat/clarification-offmenu.ts:454-487` — `classifyExitIntent()`

### Explicit exit (hard-exit immediately)

```
cancel this/that/it/the selection/these/those/the options
stop this/that/it/the selection/these/those/choosing
forget this/that/about this/about that/about it
never mind this/that/it/the selection
start over
restart
begin again
```

### Ambiguous exit (ask confirmation, keep options visible)

```
cancel, never mind, nevermind, stop, forget it, exit, quit,
no thanks, skip, something else
```

---

## 9) Correction Phrases

**Source:** `lib/chat/query-patterns.ts:117-130` — `CORRECTION_PHRASES`

```
no, nope, not that, not what i meant, not what i asked,
that's wrong, thats wrong, wrong, incorrect, different,
something else, try again
```

Effect: triggers correction handling in clarification intercept.

---

## 10) Follow-Up Phrases

**Source:** `lib/chat/query-patterns.ts:135-147` — `FOLLOWUP_PHRASES`

```
tell me more, more details, explain more, more,
how does it work, how does that work, what else,
continue, go on, expand, elaborate
```

Effect: triggers pronoun follow-up handler (e.g., expands on last doc response).

---

## 11) Meta Phrases

**Source:** `lib/chat/query-patterns.ts:152-168` — `META_PATTERNS`

```
what do you mean?
explain (that)?
help (me)? (understand)?
what are (my)? options?
what's the difference?
huh?
?
what?
not sure
i don't know
can you tell me more?
what is that?
i'm not sure what that does/means?
clarify
options?
```

Effect: requests explanation of current clarification state.

---

## 12) Reshow Phrases

**Source:** `lib/chat/query-patterns.ts:173-180` — `RESHOW_PATTERNS`

```
show (me)? (the)? options
what were those/they?
i'm confused?
(can you)? show (me)? again/them?
remind me?
options?
```

Effect: re-displays pending options.

---

## 13) Panel Token Matching (Tier 2c)

**Source:** `lib/chat/panel-command-matcher.ts`

Not a fixed vocabulary — matches dynamically against visible widget titles using token sets.

### Stopwords (removed during tokenization)

```
a, an, the, my, your, our, their, pls, please, plz, now, thanks, thank, thx
```

### Known panel terms (fuzzy match targets, edit distance <= 2)

```
panel, panels, widget, widgets, link, links, recent, demo,
open, show, close, go, view
```

### Canonical token mappings

| Token | Canonical |
|-------|-----------|
| `panel`, `panels` | `panel` |
| `widget`, `widgets` | `widget` |
| `link`, `links` | `links` |

---

## Source of Truth

This file is derived from source code. If discrepancies arise, the code is authoritative:

- `lib/chat/input-classifiers.ts` — canonicalizer, scope cues, explicit command detection
- `lib/chat/query-patterns.ts` — all pattern constants and classifier functions
- `lib/chat/known-noun-routing.ts` — `KNOWN_NOUN_MAP`
- `lib/chat/panel-command-matcher.ts` — token normalization and fuzzy matching
- `lib/chat/clarification-offmenu.ts` — exit intent classification
