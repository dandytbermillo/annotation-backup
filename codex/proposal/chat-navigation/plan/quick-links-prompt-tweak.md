# Draft: show_quick_links prompt tweak (bare "quick links")

## Goal
Allow bare phrases like "quick links" to map to `show_quick_links`, mirroring the list_workspaces shorthand.

## Proposed change
Update `lib/chat/intent-prompt.ts` under **Special Cases** so the model treats bare or generic quick-links phrases as `show_quick_links`.

### Current
```
- "show quick links" -> show_quick_links
```

### Proposed
```
- "quick links", "my quick links", "show quick links", "view quick links", "display quick links" -> show_quick_links
```

## Notes
- Keep scope limited to the exact phrase "quick links" to avoid collisions with generic "links".
- This is a prompt-only change; no schema changes required.
- Optional reinforcement: add one example under intent #14: "quick links" -> show_quick_links.

## Validation
Manual test prompts after change:
- "quick links" -> show_quick_links
- "my quick links" -> show_quick_links
- "show quick links" -> show_quick_links
- "display quick links" -> show_quick_links

## Patch preview (snippet)
```diff
@@ Special Cases
-- "show quick links" -> show_quick_links
+- "quick links", "my quick links", "show quick links", "view quick links", "display quick links" -> show_quick_links
```
