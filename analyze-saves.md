# Save Path Analysis

## Immediate saves (no debounce):
1. **Line 359**: When fallback content is persisted
2. **Line 418**: When promoting pending content  
3. **Line 511**: When restoring pending save from localStorage
4. **Line 866/872**: On visibilitychange/beforeunload

## Debounced saves:
1. **Line 767**: OnUpdate with 300ms delay

## The 178ms Mystery:
- Version 3 at 21:09:51.741 (with blockquote content)
- Version 4 at 21:09:51.919 (empty paragraph)
- Gap: 178ms (LESS than 300ms debounce)

## Possible sequence:
1. Content loads with blockquote
2. Immediate save (version 3) - maybe from line 359 if it was a fallback?
3. Editor.commands.setContent() triggers onUpdate
4. OnUpdate sees empty paragraph, considers it NOT empty (provider bug)
5. Sets hasHydratedRef = true
6. Starts 300ms debounce
7. But something ELSE triggers an immediate save at 178ms
8. That saves the empty paragraph (version 4)

## What could trigger save at 178ms?
- Another setContent call?
- Pending restore attempt?  
- Focus/blur event?
- Race condition between multiple loads?