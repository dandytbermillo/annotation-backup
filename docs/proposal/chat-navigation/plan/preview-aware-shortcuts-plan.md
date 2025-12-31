# Plan: Preview-Aware Chat Shortcuts (Hybrid Heuristic + Tiny Classifier)

## Goal
When the chat shows a preview list with a "Show all" button, let the user type a follow‑up like "show all" or "can you please open all 14 items" and open the same view panel without depending on full LLM intent parsing.

## Scope
- Applies to preview lists rendered in the chat: Quick Links, Recent, Workspaces, etc.
- Covers brief and verbose follow‑ups that mean "expand the preview".

## Non‑Goals
- Do not fetch new data from the main intent LLM.
- Do not change view panel rendering.

## Core Idea
Treat “show all / open full list” as a local UI shortcut when a preview exists. Use a hybrid approach:
1) Minimal keyword heuristic.
2) If unclear, a tiny YES/NO classifier prompt to the LLM.

---

## Data to Store (Client)
When rendering a preview message, store a lightweight reference:
```
lastPreview = {
  source: 'quick_links' | 'recent' | 'workspaces' | 'search' | 'other',
  viewPanelContent: ViewPanelContent,
  totalCount: number,
  messageId: string,
  createdAt: number,
}
```

## Step 1: Minimal Heuristic (No LLM)
Run before the LLM intent call.

Trigger when a recent preview exists AND at least one of these is true:
- Message contains "all" AND one of: items, list, results, entries
- Message contains "full list" or "complete list"
- Message contains "all" + a number (e.g., "all 14")

Examples (should match):
- "show all items"
- "open all 14 items"
- "view everything in the list"
- "open the full list"

If matched → open view panel immediately.

## Step 2: Tiny LLM Classifier (Fallback)
If heuristic doesn’t match and a preview exists, run a small classifier.

Prompt (system):
- "Answer ONLY YES or NO. The user just saw a preview list (source: <source>, total: <count>). Does the user ask to expand/show the full list from that preview? Say YES only if they are asking to open/show all items from the preview. Say NO if they are asking for any other action (e.g., open workspace, open note, rename, delete)."

Prompt (user):
- <original user input>

Behavior:
- YES → open view panel
- NO → continue with normal intent handling

## Safety Rules
- Only run this shortcut when a preview exists and is recent (e.g., 2 minutes).
- Do not override explicit commands (e.g., "open workspace X").
- If classifier is uncertain, default to NO.

---

## Implementation Steps
1) Store `lastPreview` when rendering MessageResultPreview.
2) Add shortcut interceptor before main LLM call:
   - If heuristic matches → open panel locally.
   - Else if preview exists → call tiny classifier → open panel on YES.
3) If shortcut triggers, optionally add a short confirmation in chat:
   - "Opening full list for Quick Links C."

---

## Testing Checklist
- Preview shown → "show all items" → view panel opens (heuristic).
- Preview shown → "can you please open all 14 items" → classifier YES.
- Preview shown → "open workspace 4" → normal intent (no shortcut).
- No preview → "show all items" → normal intent.

---

## Rollback
- Remove shortcut interceptor and classifier; revert to LLM‑only behavior.

## Success Criteria
- “show all” style requests open the correct view panel even for verbose phrasing.
- No extra LLM calls for simple "all items" cases.
- No false positives on explicit commands.
