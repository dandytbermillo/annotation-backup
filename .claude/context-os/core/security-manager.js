#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Security Manager - Handles all security-related operations
 */
class SecurityManager {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.configPath = path.join(contextRoot, 'config', 'security-config.json');
    this.auditLogPath = path.join(contextRoot, 'logs', 'security-audit.log');
    this.quarantinePath = path.join(contextRoot, 'quarantine');
    this.config = null;
    this.secretPatterns = [];
  }

  async initialize() {
    // Load security configuration
    this.config = JSON.parse(await fs.readFile(this.configPath, 'utf8'));
    
    // Compile regex patterns
    this.compilePatterns();
    
    // Ensure directories exist
    await fs.mkdir(path.join(this.contextRoot, 'logs'), { recursive: true });
    await fs.mkdir(this.quarantinePath, { recursive: true });
    
    // Initialize audit log
    await this.auditLog('security_manager_initialized', { version: this.config.version });
  }

  /**
   * Compile security patterns for efficient matching
   */
  compilePatterns() {
    this.secretPatterns = this.config.security.secrets_scanning.patterns.map(pattern => ({
      name: pattern.name,
      regex: new RegExp(pattern.pattern, pattern.file_pattern ? 'i' : 'gmi'),
      severity: pattern.severity,
      isFilePattern: pattern.file_pattern || false
    }));
  }

  /**
   * Scan content for secrets
   */
  async scanForSecrets(content, filePath = 'unknown') {
    if (!this.config.security.secrets_scanning.enabled) {
      return { safe: true, findings: [] };
    }

    const findings = [];
    
    // Check file path patterns
    for (const pattern of this.secretPatterns.filter(p => p.isFilePattern)) {
      if (pattern.regex.test(filePath)) {
        findings.push({
          type: pattern.name,
          severity: pattern.severity,
          file: filePath,
          match: 'File path matches sensitive pattern',
          line: 0
        });
      }
    }
    
    // Check content patterns
    const lines = content.split('\n');
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      
      for (const pattern of this.secretPatterns.filter(p => !p.isFilePattern)) {
        const matches = line.matchAll(pattern.regex);
        for (const match of matches) {
          findings.push({
            type: pattern.name,
            severity: pattern.severity,
            file: filePath,
            match: this.sanitizeSecret(match[0]),
            line: lineNum + 1,
            column: match.index
          });
        }
      }
    }
    
    if (findings.length > 0) {
      await this.handleSecretDetection(findings, filePath, content);
    }
    
    return {
      safe: findings.length === 0,
      findings
    };
  }

  /**
   * Handle detected secrets
   */
  async handleSecretDetection(findings, filePath, content) {
    const actions = this.config.security.secrets_scanning.actions;
    
    // Log the detection
    if (actions.log_attempts) {
      await this.auditLog('secrets_detected', {
        file: filePath,
        findings: findings.map(f => ({
          type: f.type,
          severity: f.severity,
          line: f.line
        }))
      });
    }
    
    // Quarantine the file if needed
    if (actions.quarantine_file && filePath !== 'unknown') {
      await this.quarantineFile(filePath, content, findings);
    }
    
    // Notify user
    if (actions.notify_user) {
      console.error('\n⚠️  SECURITY WARNING: Potential secrets detected!');
      console.error('File:', filePath);
      for (const finding of findings) {
        console.error(`  - ${finding.type} (${finding.severity}) at line ${finding.line}`);
      }
      console.error('\nAction blocked for security reasons.\n');
    }
  }

  /**
   * Quarantine a file with sensitive content
   */
  async quarantineFile(filePath, content, findings) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
    const quarantineFile = path.join(this.quarantinePath, `${timestamp}_${hash}.quarantine`);
    
    const quarantineData = {
      originalPath: filePath,
      timestamp,
      findings,
      contentHash: hash,
      content: Buffer.from(content).toString('base64')
    };
    
    await fs.writeFile(quarantineFile, JSON.stringify(quarantineData, null, 2));
    await this.auditLog('file_quarantined', { file: filePath, quarantineFile });
  }

  /**
   * Sanitize secret for logging
   */
  sanitizeSecret(secret) {
    if (secret.length <= 8) {
      return '*'.repeat(secret.length);
    }
    return secret.slice(0, 3) + '*'.repeat(secret.length - 6) + secret.slice(-3);
  }

  /**
   * Check if a file path is allowed
   */
  async checkFileAccess(filePath, operation = 'read') {
    const config = this.config.security.file_access;
    
    if (!config.sandboxing) {
      return { allowed: true };
    }
    
    const absolutePath = path.resolve(filePath);
    const projectRoot = path.resolve(this.contextRoot, '..', '..');
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    
    // Replace placeholders
    const resolvePath = (pattern) => {
      return pattern
        .replace('{PROJECT_ROOT}', projectRoot)
        .replace('{HOME}', homeDir)
        .replace(/\\/g, path.sep); // Handle Windows paths
    };
    
    // Check blocked paths
    for (const blockedPattern of config.blocked_paths) {
      const resolved = resolvePath(blockedPattern);
      if (this.matchesPattern(absolutePath, resolved)) {
        await this.auditLog('file_access_blocked', { file: filePath, operation, reason: 'blocked_path' });
        return { 
          allowed: false, 
          reason: `Access to ${filePath} is blocked for security reasons` 
        };
      }
    }
    
    // Check allowed paths
    let isAllowed = false;
    for (const allowedPattern of config.allowed_paths) {
      const resolved = resolvePath(allowedPattern);
      if (this.matchesPattern(absolutePath, resolved)) {
        isAllowed = true;
        break;
      }
    }
    
    if (!isAllowed) {
      await this.auditLog('file_access_blocked', { file: filePath, operation, reason: 'not_in_allowed_paths' });
      return { 
        allowed: false, 
        reason: `Access to ${filePath} is outside allowed paths` 
      };
    }
    
    // Check if confirmation required
    for (const confirmPattern of config.require_confirmation) {
      if (this.matchesPattern(absolutePath, confirmPattern)) {
        return { 
          allowed: true, 
          requireConfirmation: true,
          reason: `Access to ${filePath} requires confirmation` 
        };
      }
    }
    
    return { allowed: true };
  }

  /**
   * Check if a command is allowed
   */
  async checkCommand(command) {
    const config = this.config.security.command_execution;
    
    // Extract base command
    const baseCommand = command.trim().split(/\s+/)[0];
    
    // Check blocked commands
    for (const blocked of config.blocked_commands) {
      if (command.includes(blocked)) {
        await this.auditLog('command_blocked', { command, reason: 'blocked_command' });
        return { 
          allowed: false, 
          reason: `Command contains blocked pattern: ${blocked}` 
        };
      }
    }
    
    // Check if command requires confirmation
    for (const confirmPattern of config.require_confirmation) {
      if (command.includes(confirmPattern)) {
        return { 
          allowed: true, 
          requireConfirmation: true,
          reason: `Command '${confirmPattern}' requires confirmation` 
        };
      }
    }
    
    // Check allowed commands
    if (!config.allowed_commands.includes(baseCommand)) {
      // Check if it's a path to an allowed command
      const commandName = path.basename(baseCommand);
      if (!config.allowed_commands.includes(commandName)) {
        await this.auditLog('command_blocked', { command, reason: 'not_allowed' });
        return { 
          allowed: false, 
          reason: `Command '${baseCommand}' is not in allowed list` 
        };
      }
    }
    
    return { allowed: true };
  }

  /**
   * Match file path against pattern (supports glob-like patterns)
   */
  matchesPattern(filePath, pattern) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\\/g, '\\\\')
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^/\\\\]*')
      .replace(/\*\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filePath);
  }

  /**
   * Audit log
   */
  async auditLog(event, data = {}) {
    if (!this.config.security.audit.enabled) {
      return;
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      data,
      user: process.env.USER || process.env.USERNAME || 'unknown',
      pid: process.pid
    };
    
    // Append to log file
    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(this.auditLogPath, logLine).catch(() => {
      // Fail silently if can't write to log
    });
    
    // Rotate log if needed
    await this.rotateLog();
  }

  /**
   * Rotate audit log if it gets too large
   */
  async rotateLog() {
    try {
      const stats = await fs.stat(this.auditLogPath);
      const maxSize = parseInt(this.config.security.audit.log_rotation.max_size) * 1024 * 1024;
      
      if (stats.size > maxSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = this.auditLogPath.replace('.log', `.${timestamp}.log`);
        await fs.rename(this.auditLogPath, rotatedPath);
        
        // Clean up old logs
        await this.cleanupOldLogs();
      }
    } catch (e) {
      // Ignore errors
    }
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs() {
    const logsDir = path.dirname(this.auditLogPath);
    const files = await fs.readdir(logsDir);
    const logFiles = files.filter(f => f.startsWith('security-audit.') && f.endsWith('.log'));
    
    // Sort by timestamp (newest first)
    logFiles.sort().reverse();
    
    // Keep only the configured number of files
    const maxFiles = this.config.security.audit.log_rotation.max_files;
    for (let i = maxFiles; i < logFiles.length; i++) {
      await fs.unlink(path.join(logsDir, logFiles[i])).catch(() => {});
    }
  }

  /**
   * Get security status
   */
  async getStatus() {
    const status = {
      enabled: this.config.security.secrets_scanning.enabled,
      sandboxing: this.config.security.file_access.sandboxing,
      auditEnabled: this.config.security.audit.enabled,
      lastScan: null,
      quarantinedFiles: 0
    };
    
    // Get quarantine count
    try {
      const files = await fs.readdir(this.quarantinePath);
      status.quarantinedFiles = files.filter(f => f.endsWith('.quarantine')).length;
    } catch (e) {
      // Ignore
    }
    
    // Get last audit entry
    try {
      const logContent = await fs.readFile(this.auditLogPath, 'utf8');
      const lines = logContent.trim().split('\n');
      if (lines.length > 0) {
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        status.lastScan = lastEntry.timestamp;
      }
    } catch (e) {
      // Ignore
    }
    
    return status;
  }
}

module.exports = { SecurityManager };

// CLI interface
if (require.main === module) {
  const manager = new SecurityManager(path.join(__dirname, '..'));
  
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  (async () => {
    await manager.initialize();
    
    switch (command) {
      case 'scan':
        if (args.length === 0) {
          console.log('Usage: security-manager scan <file>');
          process.exit(1);
        }
        const content = await fs.readFile(args[0], 'utf8');
        const result = await manager.scanForSecrets(content, args[0]);
        if (result.safe) {
          console.log('✓ No secrets detected');
        } else {
          console.log(`⚠️  Found ${result.findings.length} potential secrets`);
          process.exit(1);
        }
        break;
        
      case 'check-access':
        if (args.length === 0) {
          console.log('Usage: security-manager check-access <file>');
          process.exit(1);
        }
        const access = await manager.checkFileAccess(args[0]);
        console.log(access.allowed ? '✓ Access allowed' : `✗ ${access.reason}`);
        break;
        
      case 'check-command':
        if (args.length === 0) {
          console.log('Usage: security-manager check-command <command>');
          process.exit(1);
        }
        const cmd = args.join(' ');
        const cmdCheck = await manager.checkCommand(cmd);
        console.log(cmdCheck.allowed ? '✓ Command allowed' : `✗ ${cmdCheck.reason}`);
        break;
        
      case 'status':
        const status = await manager.getStatus();
        console.log('Security Status:');
        console.log(`  Scanning: ${status.enabled ? 'enabled' : 'disabled'}`);
        console.log(`  Sandboxing: ${status.sandboxing ? 'enabled' : 'disabled'}`);
        console.log(`  Audit: ${status.auditEnabled ? 'enabled' : 'disabled'}`);
        console.log(`  Quarantined files: ${status.quarantinedFiles}`);
        if (status.lastScan) {
          console.log(`  Last activity: ${status.lastScan}`);
        }
        break;
        
      default:
        console.log('Usage: security-manager [scan|check-access|check-command|status]');
    }
  })();
}