# Plan: Dynamic Quick Links Badges + “Quick Link” Singular Handling

## Purpose
Remove the A–D hard limit for Quick Links and make “quick link” (singular) phrasing behave the same as “quick links.” Align chat behavior with dashboard reality where badges can extend beyond D.

---

## Problems Observed
1) **Badge limit A–D**  
   - Panels with badge E (or beyond) are not recognized by chat.
2) **Singular phrasing fails**  
   - “open quick link D” is treated as an unknown action and returns “Supported actions for this panel…”
3) **Inconsistent routing**  
   - “list my quick links” can be misrouted if the model invents new intent names.

---

## Goals
- Support **any badge that exists on the dashboard** (A, B, C, …).
- Treat **“quick link” and “quick links”** the same in chat.
- Always map list/preview requests to **show_links** (preview mode), never to a non‑existent intent.
- Preserve disambiguation rules when multiple Quick Links panels are visible.

---

## Non‑Goals
- Redesigning the Quick Links panel UI.
- Changing the storage format of Quick Links content.
- Auto‑creating new Quick Links panels via chat.

---

## Proposed Changes

### 1) Dynamic Badge Support (Registry + Prompt)
**Idea:** Build Quick Links manifests dynamically based on visible panels.
- When chat receives `visiblePanels` context (e.g., `quick-links-d`, `quick-links-e`), ensure those badges are registered in the panel registry.
- This removes the fixed A–D list and makes the prompt reflect actual panels.

**Rules:**
- If `visiblePanels` is empty, the system should not invent badges.
- When a badge is not visible, it should be disallowed or disambiguated.

---

### 2) Singular “quick link” Normalization
