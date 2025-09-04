#!/usr/bin/env node

/**
 * Status Enforcer - Prevents modifications to COMPLETE features
 * Part of Context-OS orchestration system
 */

const fs = require('fs');
const path = require('path');

class StatusEnforcer {
  constructor() {
    this.colors = {
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      reset: '\x1b[0m'
    };
  }
  
  /**
   * Check if feature is marked as COMPLETE
   */
  checkStatus(featurePath) {
    const implPath = path.join(featurePath, 'implementation.md');
    
    if (!fs.existsSync(implPath)) {
      return { isComplete: false, status: 'UNKNOWN' };
    }
    
    const content = fs.readFileSync(implPath, 'utf8');
    
    // Look for status markers
    const statusMatch = content.match(/\*\*Status\*\*:\s*([^\n]+)/i);
    if (!statusMatch) {
      return { isComplete: false, status: 'NOT_FOUND' };
    }
    
    const status = statusMatch[1].trim();
    const isComplete = status.includes('COMPLETE') || status.includes('✅');
    
    return { isComplete, status };
  }
  
  /**
   * Enforce COMPLETE status protection
   */
  enforceStatus(featurePath, operation = 'modify') {
    const { isComplete, status } = this.checkStatus(featurePath);
    
    if (isComplete) {
      console.log(`${this.colors.red}⛔ BLOCKED: Feature is COMPLETE${this.colors.reset}`);
      console.log(`Status: ${status}`);
      console.log(`Path: ${featurePath}`);
      console.log('\nThis feature has been marked as COMPLETE and cannot be modified.');
      console.log('To make changes:');
      console.log('  1. Create a new post-implementation fix in post-implementation-fixes/');
      console.log('  2. Or reopen the feature by changing status to IN PROGRESS (requires approval)');
      
      return false;
    }
    
    console.log(`${this.colors.green}✓ Status check passed${this.colors.reset}`);
    console.log(`Current status: ${status}`);
    return true;
  }
  
  /**
   * Create a reopening request
   */
  createReopenRequest(featurePath, reason) {
    const requestPath = path.join(featurePath, 'reopen-request.md');
    const date = new Date().toISOString();
    
    const content = `# Feature Reopen Request

**Date**: ${date}
**Current Status**: COMPLETE
**Requested Status**: IN PROGRESS

## Reason for Reopening
${reason}

## Approval
- [ ] Product Owner
- [ ] Technical Lead
- [ ] QA Lead

## Notes
Once approved, update implementation.md status to IN PROGRESS.
`;
    
    fs.writeFileSync(requestPath, content);
    console.log(`${this.colors.yellow}Reopen request created: ${requestPath}${this.colors.reset}`);
    return requestPath;
  }
  
  /**
   * Lock a completed feature (add .complete marker)
   */
  lockFeature(featurePath) {
    const lockFile = path.join(featurePath, '.complete');
    const implPath = path.join(featurePath, 'implementation.md');
    
    if (!fs.existsSync(implPath)) {
      console.log(`${this.colors.red}Error: No implementation.md found${this.colors.reset}`);
      return false;
    }
    
    const { isComplete, status } = this.checkStatus(featurePath);
    
    if (!isComplete) {
      console.log(`${this.colors.yellow}Warning: Feature is not COMPLETE (${status})${this.colors.reset}`);
      const proceed = process.argv.includes('--force');
      if (!proceed) {
        console.log('Use --force to lock anyway');
        return false;
      }
    }
    
    const lockContent = {
      lockedAt: new Date().toISOString(),
      status: status,
      checksum: this.calculateChecksum(implPath)
    };
    
    fs.writeFileSync(lockFile, JSON.stringify(lockContent, null, 2));
    console.log(`${this.colors.green}✓ Feature locked${this.colors.reset}`);
    return true;
  }
  
  /**
   * Calculate file checksum for integrity
   */
  calculateChecksum(filePath) {
    const crypto = require('crypto');
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  
  /**
   * Check if feature is locked
   */
  isLocked(featurePath) {
    const lockFile = path.join(featurePath, '.complete');
    
    if (!fs.existsSync(lockFile)) {
      return false;
    }
    
    try {
      const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      
      // Verify checksum
      const implPath = path.join(featurePath, 'implementation.md');
      const currentChecksum = this.calculateChecksum(implPath);
      
      if (currentChecksum !== lock.checksum) {
        console.log(`${this.colors.yellow}⚠ Lock file checksum mismatch - file may have been modified${this.colors.reset}`);
      }
      
      return true;
    } catch (e) {
      return false;
    }
  }
  
  /**
   * List all COMPLETE features
   */
  listCompleteFeatures(basePath = 'docs/proposal') {
    const features = [];
    
    if (!fs.existsSync(basePath)) {
      return features;
    }
    
    const dirs = fs.readdirSync(basePath).filter(dir => {
      const fullPath = path.join(basePath, dir);
      return fs.statSync(fullPath).isDirectory() && !dir.startsWith('.');
    });
    
    for (const dir of dirs) {
      const featurePath = path.join(basePath, dir);
      const { isComplete, status } = this.checkStatus(featurePath);
      
      if (isComplete) {
        features.push({
          name: dir,
          path: featurePath,
          status: status,
          locked: this.isLocked(featurePath)
        });
      }
    }
    
    return features;
  }
}

// CLI interface
if (require.main === module) {
  const enforcer = new StatusEnforcer();
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'check':
      const featurePath = args[1] || '.';
      enforcer.enforceStatus(featurePath);
      break;
      
    case 'lock':
      const lockPath = args[1] || '.';
      enforcer.lockFeature(lockPath);
      break;
      
    case 'list':
      const basePath = args[1] || 'docs/proposal';
      const completeFeatures = enforcer.listCompleteFeatures(basePath);
      
      if (completeFeatures.length === 0) {
        console.log('No COMPLETE features found');
      } else {
        console.log('\n📦 COMPLETE Features:');
        completeFeatures.forEach(f => {
          const lockIcon = f.locked ? '🔒' : '🔓';
          console.log(`  ${lockIcon} ${f.name} - ${f.status}`);
        });
      }
      break;
      
    case 'reopen':
      const reopenPath = args[1] || '.';
      const reason = args.slice(2).join(' ') || 'Additional work required';
      enforcer.createReopenRequest(reopenPath, reason);
      break;
      
    default:
      console.log('Usage: status-enforcer <command> [options]');
      console.log('Commands:');
      console.log('  check [path]   - Check if feature can be modified');
      console.log('  lock [path]    - Lock a COMPLETE feature');
      console.log('  list [base]    - List all COMPLETE features');
      console.log('  reopen [path] [reason] - Create reopen request');
  }
}

module.exports = StatusEnforcer;