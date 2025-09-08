# Claude Image Processing Pattern (Actual Implementation)

## Reality: We Don't Control the UI

Since we cannot modify Claude Code's UI to capture attachments, we use Claude's built-in vision capabilities as our image processor.

## The Working Pattern

### Step 1: User Provides Image + Command
```
User: /context-fix --feature dark_mode --issue "Button broken"
      [attaches screenshot]
```

### Step 2: Claude Processes (Automatically)
When Claude sees both a command and images, Claude:
1. Analyzes the images using vision
2. Extracts visual findings
3. Enriches the issue description
4. Determines severity from visual impact

### Step 3: Claude Calls Context-OS
Claude passes enriched text to Context-OS:
```javascript
{
  "feature": "dark_mode",
  "issue": "Button broken - overlaps text at 375px, contrast 1.3:1, extends 20px beyond container",
  "severity": "HIGH",
  "metrics": {
    "visualSeverity": 80,
    "usersAffected": 40
  }
}
```

## Implementation Requirements

### 1. Update Agent Guidance Files
Add to `.claude/agents/context-fixer.md`:
```markdown
When images are attached with /context-fix:
1. Analyze the images first
2. Extract specific visual issues
3. Include measurements and specifics
4. Determine severity from visual impact
5. Pass enriched description to Context-OS
```

### 2. Update Command Documentation
Add to `.claude/commands/context-fix.md`:
```markdown
## Visual Issue Support
- Attach screenshots directly in the message
- Claude will analyze and extract findings
- Visual details are added to the issue description
- Images must be present when command is sent
```

### 3. No Code Changes Required
- Context-OS CLIs continue receiving text/JSON
- No image handling code needed
- Claude does all visual processing

## Limitations & Mitigations

### Limitation 1: Images Must Be Present at Submission
**Reality**: If user removes images before sending, Claude can't see them
**Mitigation**: Clear documentation about this requirement

### Limitation 2: No Image Persistence
**Reality**: Images aren't stored in Context-OS
**Mitigation**: Claude's extracted descriptions are detailed enough

### Limitation 3: No CI/Terminal Image Support
**Reality**: Can't paste images in terminal
**Mitigation**: CI users must describe issues textually

## Testing This Pattern

1. Test with image present:
```
/context-fix --feature test --issue "UI broken" [with screenshot]
→ Should create fix with detailed visual findings
```

2. Test with image removed:
```
/context-fix --feature test --issue "UI broken" [image removed]
→ Creates fix with only text description
```

3. Test multiple images:
```
/context-fix --feature test --issue "Multiple issues" [3 screenshots]
→ Claude analyzes all, combines findings
```

## Success Criteria
✅ Claude analyzes images when present
✅ Visual findings appear in fix documents
✅ Severity reflects visual impact
✅ No Context-OS code changes needed
✅ Works within current constraints