# Context-OS Bridge Operations Guide

**Version**: 1.0.0  
**Purpose**: Quick reference for operating the Claude-Context-OS bridge

## 🚀 Quick Start

```bash
# Check configuration
export CLAUDE_MODE=mock  # Use 'real' for actual Claude
node context-os/command-router.js help

# Test commands (mock mode)
/execute "My Feature"
/analyze dark_mode
/fix --feature dark_mode --issue "Not working" --dry-run
/fix --feature dark_mode --issue "Not working" --apply
```

## 🔧 Configuration

### Environment Variables

```bash
# Claude Configuration
CLAUDE_API_KEY=sk-...          # Required for real mode
CLAUDE_MODE=mock|real           # Default: mock
CLAUDE_MODEL=claude-3-opus      # Model to use

# Budget Limits (per session)
MAX_TOKENS_PER_CALL=4000        # Per request limit
MAX_TOKENS_PER_SESSION=100000   # Session total
MAX_PARALLEL_CALLS=2            # Concurrent calls
COST_ALERT_THRESHOLD=5.00       # Alert if cost exceeds

# Safety
DEFAULT_DRY_RUN=true            # Require --apply for writes
REQUIRE_APPROVAL=true           # Show patches before apply
BACKUP_BEFORE_WRITE=true        # Create backups

# Telemetry
TELEMETRY_ENABLED=true          # Log operations
LOG_LEVEL=info                  # debug|info|warn|error
```

### Config File (Optional)

Create `context-os/config.json`:
```json
{
  "budget": {
    "maxTokensPerCall": 4000,
    "costAlertThreshold": 5.00
  },
  "commandBudgets": {
    "/analyze": { "maxTokens": 2000 },
    "/fix": { "maxTokens": 4000 }
  }
}
```

## 📊 Commands Reference

| Command | Type | Claude | Context-OS | Description |
|---------|------|--------|------------|-------------|
| `/execute` | Context-only | ❌ | ✅ | Create feature structure |
| `/analyze` | Claude-only | ✅ | ❌ | Semantic analysis |
| `/fix` | Hybrid | ✅ | ✅ | Analyze + create fix |
| `/validate` | Context-only | ❌ | ✅ | Check compliance |
| `/review` | Hybrid (parallel) | ✅ | ✅ | Quality + compliance |
| `/status` | Context-only | ❌ | ✅ | Check feature status |

### Command Flags

**Safety Flags:**
- `--dry-run`: Preview changes without writing (default for `/fix`)
- `--apply`: Actually write changes (required for modifications)

**Analysis Flags:**
- `--severity`: CRITICAL|HIGH|MEDIUM|LOW
- `--perf <0-100>`: Performance degradation %
- `--users <0-100>`: Users affected %

## 📈 Telemetry

### Location
Telemetry logs are written to `context-os/telemetry/<session-id>.jsonl`

### Format (JSON Lines)
```json
{
  "timestamp": "2024-01-01T12:00:00Z",
  "sessionId": "abc123",
  "command": "/fix",
  "route": "hybrid",
  "tools": ["Task", "Grep"],
  "tokenEstimate": 1250,
  "duration": 3500,
  "exitStatus": "success",
  "artifacts": ["patches/fix-123.patch"]
}
```

### Key Fields
- `command`: The slash command executed
- `route`: `claude-only` | `context-only` | `hybrid`
- `tools`: Which Claude tools were used
- `tokenEstimate`: Approximate tokens consumed
- `exitStatus`: `success` | `failure` | `degraded`
- `duration`: Total execution time in ms

## 🚨 Failure Interpretation

### Status Codes
- `ok`: Command succeeded completely
- `degraded`: Partial success (e.g., Claude failed but Context-OS worked)
- `error`: Command failed

### Common Failures

**"Token budget exceeded"**
- Session has used too many tokens
- Solution: Reset session or increase budget

**"Claude unavailable - falling back"**
- Claude API timeout or error
- System continues with Context-OS only
- Result marked as `degraded`

**"Validation failed"**
- Structure doesn't comply with Documentation Process Guide
- Run `/validate` for details
- Use `/fix` to remediate

**"Missing API key"**
- CLAUDE_API_KEY not set for real mode
- System automatically uses mock mode

## 🔒 Safety Rails

### Dry-Run by Default
```bash
/fix --feature x --issue "Bug"        # DRY RUN (preview only)
/fix --feature x --issue "Bug" --apply # Actually creates fix
```

### Patch Generation
All modifications generate patches in `patches/`:
```
patches/
├── fix-2024-01-01T12-00-00.patch
├── migration-2024-01-01T13-00-00.patch
└── applied/  # Successfully applied patches
```

### Budget Protection
```
Session: abc123
Tokens used: 45,000 / 100,000
Calls made: 12 / 50
Cost estimate: $0.90
```

## 🔄 Workflows

### Create Feature
```bash
/execute "User Authentication"
# → Creates docs/proposal/user_authentication/
# → Validates structure
# → Returns success/failure
```

### Analyze Feature (Mock)
```bash
/analyze dark_mode
# → Claude analyzes (mocked)
# → Returns findings + recommendations
# → Shows confidence score
```

### Fix Issue (Hybrid)
```bash
# Step 1: Dry run
/fix --feature dark_mode --issue "Toggle broken" --dry-run
# → Claude analyzes issue
# → Context-OS classifies severity
# → Shows patch preview

# Step 2: Apply if looks good
/fix --feature dark_mode --issue "Toggle broken" --apply
# → Creates fix document
# → Generates patch
# → Updates indices
```

## 📊 Monitoring

### Check System Status
```bash
# View configuration
CLAUDE_MODE=mock LOG_LEVEL=debug node context-os/command-router.js help

# Check feature status
/status dark_mode

# Validate all features
/validate --all --strict
```

### Cost Tracking
```bash
# Session telemetry includes token usage
cat context-os/telemetry/*.jsonl | jq '.tokenEstimate' | paste -sd+ | bc
```

### Error Patterns
Look for in telemetry:
- `exitStatus: "degraded"` - Fallback occurred
- `exitStatus: "failure"` - Command failed
- `duration > 30000` - Potential timeout

## 🐛 Troubleshooting

### Bridge Won't Start
1. Check Node.js version (>= 14)
2. Verify paths exist: `docs/proposal/`, `context-os/`
3. Check config: `CLAUDE_MODE=mock node command-router.js help`

### Commands Hang
1. Check timeout: `TIMEOUT_MS=60000`
2. Verify network if `CLAUDE_MODE=real`
3. Check telemetry for errors

### Patches Won't Apply
1. Ensure clean git status
2. Check patch file exists
3. Try manual: `git apply patches/fix.patch`

## 🚀 CI Integration

### GitHub Actions Example
```yaml
- name: Validate Documentation
  run: |
    npm install
    /validate --all --strict
    
- name: Fix Issues
  run: |
    /fix --feature ${{ github.event.inputs.feature }} \
         --issue "CI validation errors" \
         --dry-run
```

### Success Criteria
✅ `/execute <feature>` → Creates structure  
✅ `/analyze <feature>` → Returns findings  
✅ `/fix --dry-run` → Shows patch  
✅ `/fix --apply` → Creates fix + passes validation  
✅ Telemetry shows all operations  

## 📚 Advanced

### Switch Modes
```bash
# Development (mock)
export CLAUDE_MODE=mock

# Production (real Claude)
export CLAUDE_MODE=real
export CLAUDE_API_KEY=sk-...
```

### Custom Budgets
```bash
# Per-command limits
export ANALYZE_MAX_TOKENS=1000
export FIX_MAX_TOKENS=5000
```

### Debug Mode
```bash
LOG_LEVEL=debug node context-os/command-router.js analyze my_feature
```

## 🆘 Support

- Logs: `context-os/telemetry/`
- Config: `context-os/config.json`
- Patches: `patches/`
- Issues: Check telemetry for `exitStatus: "failure"`