# Context-OS v2.0 Migration Guide

This guide helps existing Context-OS users migrate to v2.0 with its enhanced security and safety features.

## ⚠️ Breaking Changes

### 1. **Automation Disabled by Default**
- Git hooks are now created as `.sample` files
- Team sync is disabled by default
- CI/CD pipelines require explicit enablement
- Scheduled tasks are set to manual

### 2. **Security Restrictions**
- File access is now sandboxed
- Command execution is restricted to whitelist
- Secret scanning blocks commits by default
- Certain paths require confirmation

### 3. **Team Collaboration Changes**
- Auto-propagation is disabled
- All sharing requires voting
- Minimum 2 votes required
- 48-hour vote timeout

## 🔄 Migration Steps

### Step 1: Backup Current Configuration
```bash
# Backup your current setup
cp -r .claude/context-os .claude/context-os-v1-backup

# Backup knowledge base
cp -r .claude/context-os/knowledge .claude/knowledge-backup
```

### Step 2: Install v2.0
```bash
# Run the new cross-platform setup
node .claude/context-os/setup-cross-platform.js

# This will:
# - Update configuration files
# - Create new security configs
# - Set safe defaults
# - Preserve your knowledge base
```

### Step 3: Review Security Configuration
Check `.claude/context-os/config/security-config.json`:
```json
{
  "security": {
    "secrets_scanning": {
      "enabled": true,  // Keep enabled
      "patterns": [...],  // Review patterns
      "actions": {
        "on_detection": "block"  // Or "warn"
      }
    }
  }
}
```

### Step 4: Re-enable Features (Optional)

#### Enable Git Hooks
```bash
# Review hook contents first
cat .git/hooks/pre-commit.sample

# If satisfied, enable
mv .git/hooks/pre-commit.sample .git/hooks/pre-commit
mv .git/hooks/post-commit.sample .git/hooks/post-commit
```

#### Enable Team Features
```bash
# Enable with confirmation
node .claude/context-os/team/team-sync-v2.js enable --confirmed

# Update settings
# Edit .claude/context-os/config/settings.json
{
  "team": {
    "enabled": true,
    "sync_frequency": "manual",  // Not "on_commit"
    "review_required": true
  }
}
```

#### Enable Automation (Carefully)
```json
// In settings.json
{
  "automation": {
    "hooks_enabled": true,
    "require_user_confirmation": true,  // Keep true
    "dry_run_by_default": true  // Recommended
  }
}
```

### Step 5: Update Token Budgets
Review `.claude/context-os/config/token-budget.json`:
```json
{
  "budgets": {
    "default": {
      "max_context_tokens": 8000,  // Adjust based on model
      "warning_threshold": 6000
    }
  }
}
```

### Step 6: Migrate Team Configuration
If you were using team features:
```bash
# Old team config location
cat .claude/context-os/team/team.yaml

# Convert to new format in team-config.json
{
  "voting": {
    "minVotes": 2,
    "requireMajority": true
  }
}
```

### Step 7: Test Security Features
```bash
# Test secret scanning
echo "aws_access_key_id=AKIAIOSFODNN7EXAMPLE" > test.txt
node .claude/context-os/core/security-manager.js scan test.txt
# Should detect and block

# Test file access
node .claude/context-os/core/security-manager.js check-access /etc/passwd
# Should block

# Clean up
rm test.txt
```

## 📊 Configuration Mapping

### Old Setting → New Setting

| Old Location | Old Setting | New Location | New Setting | Default |
|--------------|-------------|--------------|-------------|---------|
| settings.json | `team.auto_propagate: true` | settings.json | `team.auto_propagate: false` | false |
| settings.json | `automation.hooks_enabled: true` | settings.json | `automation.hooks_enabled: false` | false |
| settings.json | `team.review_required: false` | settings.json | `team.review_required: true` | true |
| settings.json | `metrics.track_usage: true` | settings.json | `metrics.track_usage: false` | false |
| N/A | N/A | security-config.json | `secrets_scanning.enabled` | true |
| N/A | N/A | token-budget.json | `budgets.default` | 8000 |

## 🔍 Validation Checklist

After migration, verify:

- [ ] Secret scanning is working
- [ ] File sandboxing is active
- [ ] Git hooks are `.sample` files
- [ ] Team features require confirmation
- [ ] Knowledge base is intact
- [ ] Logs are being written
- [ ] Token budgets are enforced

## 🆘 Rollback Procedure

If you need to rollback:
```bash
# Restore v1 backup
mv .claude/context-os .claude/context-os-v2
mv .claude/context-os-v1-backup .claude/context-os

# Re-enable v1 git hooks
chmod +x .git/hooks/pre-commit
chmod +x .git/hooks/post-commit
```

## 🐛 Common Issues

### Issue: Git hooks not working
**Solution**: Hooks are now `.sample` files. Rename to enable:
```bash
mv .git/hooks/pre-commit.sample .git/hooks/pre-commit
```

### Issue: File access denied
**Solution**: Check security-config.json allowed_paths:
```json
{
  "file_access": {
    "allowed_paths": [
      "{PROJECT_ROOT}/**",
      "/path/to/other/allowed/dir/**"
    ]
  }
}
```

### Issue: Team sync not working
**Solution**: Team features are off by default:
```bash
node .claude/context-os/team/team-sync-v2.js enable --confirmed
```

### Issue: Commands blocked
**Solution**: Add to allowed commands in security-config.json:
```json
{
  "command_execution": {
    "allowed_commands": [
      "git", "npm", "your-command"
    ]
  }
}
```

## 📝 Best Practices

1. **Start with defaults**: Don't enable everything at once
2. **Test incrementally**: Enable features one by one
3. **Review logs**: Check security audit logs regularly
4. **Team coordination**: Discuss voting rules with team
5. **Monitor tokens**: Watch token usage with new budgets

## 🚀 New Features to Explore

After migration, try these new features:

1. **Knowledge Confidence Scoring**
   ```bash
   node .claude/context-os/core/knowledge-metadata.js stats
   ```

2. **Security Status**
   ```bash
   node .claude/context-os/core/security-manager.js status
   ```

3. **Log Search**
   ```bash
   node .claude/context-os/core/logging-manager.js search "error"
   ```

4. **Token Budget Monitoring**
   ```bash
   context load --show-tokens
   ```

## 📞 Support

For migration help:
1. Check logs in `.claude/context-os/logs/`
2. Review security audit log
3. Verify configuration syntax
4. Test with minimal setup first