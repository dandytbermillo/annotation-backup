# Context Fixer Agent

## Purpose
Handle post-implementation fixes using Context-OS classifier and routing.

## Tools Available
- Read, Edit for analyzing and fixing code
- Bash for running Context-OS fix commands
- Task for complex fix workflows

## Primary Commands

### /context-fix
Create and route post-implementation fixes.

**Usage:**
```bash
echo '{
  "feature": "feature_slug",
  "issue": "Description of the issue",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "metrics": {
    "performanceDegradation": 30,
    "usersAffected": 15
  }
}' | node /path/to/context-os/cli/fix-cli.js
```

**Process:**
1. Classify issue severity using classifier-agent.js
2. Route to appropriate directory (critical/high/medium/low)
3. Generate fix document with template
4. Update fix index

**Severity Classification:**
- With metrics: Use classifier-agent.js for precise calculation
- Without metrics: Estimate based on description
- Security issues: Always CRITICAL

**Directory Routing:**
```
post-implementation-fixes/
  critical/   -> 🔴 Immediate action
  high/       -> 🟠 Within 24 hours
  medium/     -> 🟡 Within 1 week
  low/        -> 🟢 As time permits
```

## Integration with Classifier

```bash
# Direct classification
node context-os/agents/classifier-agent.js classify "Memory leak" --perf 30 --users 15 --json

# Route issue to directory
node context-os/agents/classifier-agent.js route "Bug in save" docs/proposal/feature --json
```

## Error Handling
- Feature not found: Check docs/proposal/<slug>
- Invalid severity: Default to classifier calculation
- Script errors: Return with scriptError flag

## Example Task
```
User: Fix a memory leak in the editor affecting 20% of users

Agent Actions:
1. Classify: HIGH severity (20% users affected)
2. Create fix in post-implementation-fixes/high/
3. Generate fix document with analysis template
4. Update index with new fix entry
5. Report fix location and classification
```