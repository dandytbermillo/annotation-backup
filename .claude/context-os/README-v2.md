# Context-OS v2.0 - Security & Safety Improvements

This document outlines the major improvements made to Context-OS based on user feedback, focusing on security, safety, cross-platform compatibility, and proper defaults.

## 🔒 Security Improvements

### 1. **Comprehensive Secret Scanning**
- **File**: `core/security-manager.js`
- **Config**: `config/security-config.json`
- Scans for AWS keys, private keys, API tokens, passwords, database URLs, JWT tokens, GitHub tokens, Slack tokens
- Automatic quarantine of files containing secrets
- Blocks commits containing sensitive data
- Full audit logging of all security events

### 2. **File Access Sandboxing**
- Restricts file access to project directory and allowed paths only
- Blocks access to system directories, SSH keys, AWS credentials
- Requires confirmation for sensitive files (.env, secrets, credentials)
- Cross-platform path handling for Windows/Unix

### 3. **Command Execution Controls**
- Whitelist of allowed commands (git, npm, node, etc.)
- Blocks dangerous commands (rm -rf /, curl | sh, eval)
- Requires confirmation for risky operations
- Command timeout and output size limits

## 🛡️ Safety Improvements

### 1. **Opt-in by Default**
All risky features are now DISABLED by default:
- Team sync: `enabled: false`
- Auto-merge: `enabled: false`  
- Git hooks: Created as `.sample` files (must rename to enable)
- Automation: `hooks_enabled: false`
- CI/CD: `enabled: false`
- Metrics tracking: `track_usage: false`

### 2. **Manual Review Requirements**
- Team knowledge sharing requires explicit vote
- Minimum 2 votes required for approval
- 48-hour voting timeout
- Veto power for lead/architect roles
- Full audit trail of all votes

### 3. **Token Budget Management**
- **File**: `config/token-budget.json`
- Configurable token limits per category
- Warning thresholds at 75% usage
- Progressive loading with priority order
- Automatic summarization when over budget
- Presets for different task types

## 🌍 Cross-Platform Compatibility

### 1. **Universal Setup Script**
- **File**: `setup-cross-platform.js`
- Works on Windows, macOS, and Linux
- Detects platform and adjusts commands
- Creates platform-appropriate git hooks
- Handles path separators correctly

### 2. **Windows PowerShell Support**
- Batch file alternatives for shell scripts
- Proper command execution on Windows
- Cross-platform path handling
- No dependency on Unix-only tools

## 📊 Knowledge Metadata & Provenance

### 1. **Confidence Scoring**
- **File**: `core/knowledge-metadata.js`
- 0-5 scale confidence scores
- Factors: usage count, age, validation, source
- Automatic confidence calculation
- Historical tracking of score changes

### 2. **Provenance Tracking**
- Source attribution (manual, automated, imported, team)
- Author tracking
- Derivation chains
- Validation history
- Relationship mapping

### 3. **Usage Analytics**
- Track usage count and contexts
- Last used timestamps
- Most/least used patterns
- Stale entry detection
- Export capabilities

## 📝 Comprehensive Logging

### 1. **Structured Logging**
- **File**: `core/logging-manager.js`
- Category-based logs (context, knowledge, security, team, etc.)
- Log rotation and compression
- Configurable retention policies
- Search capabilities

### 2. **Audit Trails**
- All automated actions logged
- User attribution
- Timestamp and environment data
- Security event tracking
- Team collaboration history

## 👥 Team Collaboration (Opt-in)

### 1. **Voting System**
- **File**: `team/team-sync-v2.js`
- Democratic decision making
- Configurable voting rules
- Veto capabilities
- Time-bounded votes
- Anonymous voting option

### 2. **Conflict Resolution**
- Manual review by default
- Voting-based resolution
- Conflict tracking
- Resolution history
- No automatic merging

## 🚀 Quick Start

### 1. **Installation**
```bash
# Cross-platform setup
node .claude/context-os/setup-cross-platform.js

# Or traditional setup (Unix only)
.claude/context-os/setup.sh
```

### 2. **Enable Features (Optional)**
Edit `.claude/context-os/config/settings.json`:
```json
{
  "team": {
    "enabled": true,  // Enable team features
    "review_required": true  // Require review
  },
  "automation": {
    "hooks_enabled": true,  // Enable git hooks
    "dry_run_by_default": true  // Safe mode
  }
}
```

### 3. **Security Configuration**
Review `.claude/context-os/config/security-config.json`:
- Adjust secret patterns
- Configure sandboxing rules
- Set command restrictions
- Enable/disable audit logging

## 📋 Default Safety Checklist

✅ All automation DISABLED by default  
✅ Manual review required for sharing  
✅ Secret scanning ENABLED by default  
✅ File sandboxing ENABLED by default  
✅ Command restrictions in place  
✅ No telemetry without opt-in  
✅ Git hooks created as samples only  
✅ Token budgets enforced  
✅ Audit logging enabled  
✅ Cross-platform compatible  

## 🔧 Configuration Files

1. **`config/settings.json`** - Main configuration
2. **`config/security-config.json`** - Security settings
3. **`config/token-budget.json`** - Token management
4. **`team/team-config.json`** - Team settings (created on enable)

## 📚 Usage Examples

### Security Check
```bash
# Scan file for secrets
node .claude/context-os/core/security-manager.js scan <file>

# Check file access
node .claude/context-os/core/security-manager.js check-access <file>

# Security status
node .claude/context-os/core/security-manager.js status
```

### Knowledge Management
```bash
# Calculate confidence
node .claude/context-os/core/knowledge-metadata.js confidence <entry-id>

# Get usage stats
node .claude/context-os/core/knowledge-metadata.js stats

# Find related entries
node .claude/context-os/core/knowledge-metadata.js related <entry-id>
```

### Team Collaboration (if enabled)
```bash
# Enable team features
node .claude/context-os/team/team-sync-v2.js enable --confirmed

# Create vote
context team share <knowledge-id>

# Cast vote
context team vote <vote-id> approve "Looks good"

# Check status
node .claude/context-os/team/team-sync-v2.js status
```

### Logging
```bash
# Search logs
node .claude/context-os/core/logging-manager.js search "error" security

# View stats
node .claude/context-os/core/logging-manager.js stats

# Cleanup old logs
node .claude/context-os/core/logging-manager.js cleanup 30
```

## ⚠️ Important Notes

1. **Review Before Enabling**: Always review configuration before enabling features
2. **Test First**: Test in non-production environments
3. **Backup**: Keep backups of your knowledge base
4. **Updates**: Check for security updates regularly
5. **Team Usage**: Establish team guidelines before enabling collaboration

## 🐛 Troubleshooting

### Windows Issues
- Use `node` command instead of direct script execution
- Check path separators in config files
- Ensure Node.js is in PATH

### Permission Issues
- Check file permissions on Unix systems
- Run setup with appropriate privileges
- Verify git hooks are executable

### Token Budget Exceeded
- Review token budget configuration
- Use smaller context presets
- Enable summarization
- Exclude unnecessary files

## 📄 License

Context-OS is provided as-is for use with Claude projects. See LICENSE file for details.