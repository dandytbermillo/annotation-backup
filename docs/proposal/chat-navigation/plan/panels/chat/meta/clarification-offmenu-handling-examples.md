# Clarification Off‑Menu — Example Conversations (Reference)

These examples follow the **Prompt Template (Consistent Base + Adaptive Tail)** from:
`clarification-offmenu-handling-plan.md`

Use this file as a **reference only** for implementation and QA. It is intentionally verbose to show the intended UX pacing.

---

## 1) Hesitation / “I don’t know”

**Bot:** Multiple Links Panel panels found. Which one would you like to open?
**[Links Panel D] [Links Panel E]**

**User:** hmmm
**Bot:** **Which one do you mean — or** if neither looks right, say **“none of these”** (or **“none of those”**) or tell me one detail (where it is / what it’s called).
**[Links Panel D] [Links Panel E]**

**User:** i don’t know
**Bot:** **Which one do you mean — or** if neither looks right, say **“none of these”** (or **“none of those”**) or tell me one detail (where it is / what it’s called).
**[Links Panel D] [Links Panel E]**

---

## 1b) Hesitation with Many Options (Variant)

**Bot:** I found several Links Panels. Which one would you like to open?  
**[Links Panel A] [Links Panel B] [Links Panel C] [Links Panel D] [Links Panel E]**

**User:** hmm
**Bot:** No rush — which one is closer? You can reply with the exact name or a number.  
**[Links Panel A] [Links Panel B] [Links Panel C] [Links Panel D] [Links Panel E]**

**User:** i don’t know
**Bot:** Got it — tell me one detail (where it is / what it’s called), or pick a number.  
**[Links Panel A] [Links Panel B] [Links Panel C] [Links Panel D] [Links Panel E]**

---

## 2) Repair phrase “not that”

**User:** not that
**Bot:** Okay — not that one. **Which one do you mean instead — or** say **“none of these”** (or **“none of those”**) or tell me what it’s called.
**[Links Panel D] [Links Panel E]**

---

## 3) “No” (ambiguous refusal)

**User:** no
**Bot:** No problem. **Which one do you mean — or** say **“none of these”** (or **“none of those”**) or tell me where it is (Docs or Notes).
**[Links Panel D] [Links Panel E]**

---

## 3b) “No” with Many Options (Variant)

**User:** no
**Bot:** No problem. Which one do you mean? You can reply with a name or number.  
**[Links Panel A] [Links Panel B] [Links Panel C] [Links Panel D] [Links Panel E]**

---

## 4) “None of those” (reject list)

**User:** none of those
**Bot:** Got it. Tell me one detail (exact name or where it lives) — or I can show more results.

---

## 5) Unparseable replies (Attempt 1 escalation)

**User:** asdf
**Bot:** I didn't catch that. Reply **first** or **second**, or say **"none of these"** (or **"none of those"**), or tell me one detail.
**[Links Panel D] [Links Panel E]**

---

## 5b) Unparseable replies with Many Options (Variant)

**User:** asdf
**Bot:** I didn't catch that. Reply with a name or a number, or tell me one detail.  
**[Links Panel A] [Links Panel B] [Links Panel C] [Links Panel D] [Links Panel E]**

---

## 6) Ordinal phrasing

**User:** the first option
**Bot:** Opening **Links Panel D**.

**User:** the second one
**Bot:** Opening **Links Panel E**.

---

## 7) Cross‑Corpus Example (Docs vs Notes)

**Bot:** I found results in both documentation and your notes.
**Which one do you mean — or** if neither looks right, say **“none of these”** (or **“none of those”**) or tell me one detail (where it is / what it’s called).
**[Docs: Workspace] [Notes: New Note – Nov 30, 3:06 PM]**

**User:** the second one pls
**Bot:** Opening **Notes: New Note – Nov 30, 3:06 PM**.

**User:** not that
**Bot:** Okay — not that one. **Which one do you mean instead — or** say **“none of these”** (or **“none of those”**) or tell me what it’s called.
**[Docs: Workspace] [Notes: New Note – Nov 30, 3:06 PM]**

**User:** none of those
**Bot:** Got it. Tell me one detail (exact name or where it lives) — or I can show more results.

---

## 8) Workspace List Example

**Bot:** I found 7 workspaces.
**Which one do you mean — or** if neither looks right, say **“none of these”** (or **“none of those”**) or tell me one detail (where it is / what it’s called).
**[Workspace 2] [Workspace 6] [Sprint 12] [Sprint 14] [test1] [sample A] [Dashboard]**

**User:** the first one
**Bot:** Opening **Workspace 2**.

**User:** not that
**Bot:** Okay — not that one. **Which one do you mean instead — or** say **“none of these”** (or **“none of those”**) or tell me what it’s called.
**[Workspace 2] [Workspace 6] [Sprint 12] [Sprint 14] [test1] [sample A] [Dashboard]**

**User:** no
**Bot:** No problem. **Which one do you mean — or** say **“none of these”** (or **“none of those”**) or tell me where it is (Docs or Notes).
**[Workspace 2] [Workspace 6] [Sprint 12] [Sprint 14] [test1] [sample A] [Dashboard]**

**User:** none of those
**Bot:** Got it. Tell me one detail (exact name or where it lives) — or I can show more results.

---

## 9) Response‑Fit Examples (Classifier Layer)

These examples align with `clarification-response-fit-plan.md` and show how responses change when the user message **does not fit** the current pill context.

### 9.1 Hint word → ask_clarify (no auto‑select)

**Bot:** Multiple Links Panel panels found. Which one would you like to open?
**[Links Panel D] [Links Panel E]**

**User:** sdk
**Bot:** Are you looking for **Links Panel E**? If yes, choose E; if not, choose D.
**[Links Panel D] [Links Panel E]**

### 9.1b Hint word with Many Options (Variant)

**Bot:** Multiple Links Panel panels found. Which one would you like to open?
**[Links Panel A] [Links Panel B] [Links Panel C] [Links Panel D] [Links Panel E]**

**User:** sdk
**Bot:** Got it — which one looks closer to **SDK**? You can reply with the exact name or a number.
**[Links Panel A] [Links Panel B] [Links Panel C] [Links Panel D] [Links Panel E]**

### 9.2 Ambiguous near‑match → soft_reject

**Bot:** Multiple Links Panel panels found. Which one would you like to open?
**[Links Panel D] [Links Panel E]**

**User:** panel thing
**Bot:** Did you mean **Links Panel D**, or would you like to try again?
**[Links Panel D] [Links Panel E]**

### 9.3 New topic detection (clear command)

**Bot:** Multiple Links Panel panels found. Which one would you like to open?
**[Links Panel D] [Links Panel E]**

**User:** open recent
**Bot:** Opening Recent…

### 9.4 Noise / unparseable input

**Bot:** Multiple Links Panel panels found. Which one would you like to open?
**[Links Panel D] [Links Panel E]**

**User:** asdf
**Bot:** I didn't catch that. Reply **first** or **second**, or say **"none of these"** (or **"none of those"**), or tell me one detail.
**[Links Panel D] [Links Panel E]**

### 9.5 Constrained LLM fallback (ambiguous phrasing)

**Bot:** Multiple Links Panel panels found. Which one would you like to open?
**[Links Panel D] [Links Panel E]**

**User:** the one about panel d
**Bot:** Opening **Links Panel D**.
