# Implementable Image Handling (What We Can Actually Build)

## Given Our Constraints

Since we cannot modify Claude Code's UI but control Context-OS tools, here's what we can implement:

## Option 1: Enhanced CLI with Image References

### Implementation in fix-cli.js
```javascript
// Add to fix-cli.js
const input = JSON.parse(inputJson);

// NEW: Accept image references
const enhancedInput = {
  ...input,
  imageRefs: input.imageRefs || [], // Array of paths
  visualFindings: input.visualFindings || [] // Claude's analysis
};

// Store in fix document
const fixContent = `
## Visual Evidence
${enhancedInput.imageRefs.map(ref => `- ![](${ref})`).join('\n')}

## Visual Analysis
${enhancedInput.visualFindings.join('\n')}
`;
```

### How Claude Would Use It
```javascript
// When Claude sees images
const visualAnalysis = [
  "Button extends 20px beyond container at 375px",
  "Text contrast 1.3:1 (WCAG failure)",
  "Z-index conflict with navigation"
];

// Claude calls CLI
const command = {
  feature: "dark_mode",
  issue: "Button rendering issues - " + visualAnalysis.join(", "),
  visualFindings: visualAnalysis,
  imageRefs: [] // No actual images stored yet
};
```

## Option 2: Image Storage Pattern

### Add Image Storage Command
```javascript
// New file: context-os/cli/store-image-cli.js
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Read base64 image from stdin
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const { feature, imageData, description } = JSON.parse(input);
  
  // Generate unique filename
  const hash = crypto.createHash('sha256')
    .update(imageData)
    .digest('hex')
    .substring(0, 8);
  
  const filename = `${Date.now()}-${hash}.png`;
  const filepath = `docs/proposal/${feature}/implementation-details/artifacts/${filename}`;
  
  // Save image
  const buffer = Buffer.from(imageData, 'base64');
  fs.writeFileSync(filepath, buffer);
  
  // Return reference
  console.log(JSON.stringify({
    ok: true,
    path: filepath,
    description: description
  }));
});
```

### How Claude Would Use It
1. Claude sees image
2. Claude extracts base64 using Read tool (if file) or describes it
3. Claude stores image: `echo '{"feature":"dark_mode","imageData":"..."}' | node store-image-cli.js`
4. Claude includes returned path in fix command

## Option 3: Two-Phase Pattern (Most Practical)

### Phase 1: Analysis with Images
```
User: "Analyze this bug" [images attached]
Claude: "I can see:
  - Button overlap at 375px
  - Contrast ratio 1.3:1
  - Mobile viewport issues"
```

### Phase 2: Fix Creation with Analysis
```
User: /context-fix --feature dark_mode --issue "Issues identified above"
Claude: [Creates fix with detailed findings from Phase 1]
```

## What We Should Actually Implement

### 1. Enhance CLIs to Accept Visual Findings
```javascript
// fix-cli.js changes
const schema = {
  feature: String,
  issue: String,
  visualFindings: [String], // NEW
  imageRefs: [String], // NEW
  metrics: Object
};
```

### 2. Update Fix Document Template
```javascript
// In fix-workflow.js
if (input.visualFindings?.length > 0) {
  content += '\n## Visual Analysis\n';
  content += input.visualFindings.map(f => `- ${f}`).join('\n');
}

if (input.imageRefs?.length > 0) {
  content += '\n## Visual Evidence\n';
  content += input.imageRefs.map(ref => `![](${ref})`).join('\n');
}
```

### 3. Document the Pattern
Update `.claude/agents/context-fixer.md`:
```markdown
When user provides images:
1. Analyze them thoroughly
2. Extract specific measurements
3. Add findings to visualFindings array
4. Include in the JSON when calling fix-cli.js
```

## Implementation Checklist

### Immediate (No Code Needed)
- [ ] Document Claude's image analysis pattern
- [ ] Update agent guidance files
- [ ] Add examples to command help

### Quick Win (Minor Code)
- [ ] Add visualFindings field to fix-cli.js schema
- [ ] Update fix template to include visual analysis section
- [ ] Test with mock visual findings

### Future Enhancement (More Complex)
- [ ] Build store-image-cli.js for image persistence
- [ ] Add image reference handling
- [ ] Create image management utilities

## Testing Strategy

### Test 1: Visual Findings Integration
```bash
echo '{
  "feature": "test",
  "issue": "Button broken",
  "visualFindings": [
    "Button extends 20px beyond container",
    "Contrast ratio 1.3:1"
  ]
}' | node context-os/cli/fix-cli.js
```
Expected: Fix document includes Visual Analysis section

### Test 2: Claude with Images
```
User: /context-fix --feature test --issue "broken" [image]
Claude: Should analyze image and include findings
Result: Fix has detailed visual analysis
```

## Reality-Based Success Criteria
✅ Claude can analyze images and pass findings to Context-OS
✅ Visual findings appear in fix documents
✅ No UI modifications needed (we can't control that)
✅ Works within our actual constraints
✅ Provides value despite limitations