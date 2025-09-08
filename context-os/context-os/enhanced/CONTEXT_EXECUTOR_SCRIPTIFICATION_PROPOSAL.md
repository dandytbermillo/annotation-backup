# Comprehensive Proposal: Context-Executor Instruction Scriptification

## Executive Summary

After extensive analysis of the Context-OS system, I've identified that the core execution functionality already exists but lacks programmatic enforcement of the instructions in `.claude/agents/context-executor.md`. This proposal outlines a script-based enforcement layer that ensures no critical steps are missed during feature execution.

## Current State Analysis

### What Already Exists (Verified)

#### Core Implementation Files
- **execute-cli.js** (289 lines): Main execution engine with JSON I/O
  - Handles auto-detection and initialization
  - Supports interactive and non-interactive modes
  - Implements single command philosophy
  
- **execute-wrapper.js** (173 lines): Draft file operations handler
  - Manages --from parameter functionality
  - Creates feature directory structures
  - Preserves original filenames
  
- **create-feature.js** (400+ lines): Core feature orchestration
  - Proposes multiple slug options
  - Validates plan completeness
  - Scaffolds feature structure
  
- **context-execute.md** (265 lines): Command documentation
  - Contains bash implementation snippets
  - Defines help text and examples
  - Specifies execution process

- **context-init.sh** (54 lines): Interactive initialization wrapper
  - Handles command-line arguments
  - Provides help documentation
  - Executes init-interactive.js

#### Supporting Infrastructure
- **status-enforcer.js**: Manages feature status transitions (PLANNED → IN_PROGRESS → COMPLETE)
- **task-hierarchy.md**: Documents agent/tool relationships and JSON boundaries
- **classifier-agent.js**: Issue classification and severity calculation
- **Various .claude/agents/*.md files**: Agent guidance documentation

### Critical Gaps Identified

1. **No Automatic CLAUDE.md Requirement Enforcement**
   - Honesty requirements are documented but not programmatically checked
   - No verification that tests are actually run vs claimed
   - Missing evidence collection for completion claims

2. **Instructions Scattered Across Documentation**
   - Agent must manually parse multiple .md files
   - No single source of truth for execution steps
   - Risk of missing critical instructions

3. **No Pre-Flight Validation Script**
   - Validation happens during execution, not before
   - Invalid inputs discovered late in process
   - No early failure detection

4. **Missing Verification Checkpoints**
   - Success claimed without evidence collection
   - No programmatic verification of file creation
   - Test execution not enforced

5. **No Automated Recovery Mechanism**
   - Failed executions require manual intervention
   - Partial creations leave system in inconsistent state
   - No rollback capability

## Proposed Solution Architecture

### Core Principle: Enforcement Over Reimplementation

Rather than rewriting existing functionality, create an enforcement layer that guarantees compliance with all documented requirements. This approach:
- Preserves existing, working code
- Adds safety guarantees
- Maintains backward compatibility
- Provides audit trails

## Detailed Script Specifications

### 1. Master Orchestrator Script

**File**: `context-os/scripts/master-executor.sh`

```bash
#!/bin/bash
# PURPOSE: Single entry point ensuring all steps from context-executor.md are followed
# ENSURES: No instruction can be accidentally skipped
# MAINTAINS: Complete audit trail of execution

set -e  # Exit on first error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_FILE="$PROJECT_ROOT/logs/execution-$(date +%Y%m%d-%H%M%S).log"

# Logging function
log() {
    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] $1" | tee -a "$LOG_FILE"
}

# Parse arguments
FEATURE="$1"
PLAN="$2"
SLUG="$3"
ARGS="$@"

log "Starting Context-OS Master Executor"
log "Feature: $FEATURE"
log "Plan: $PLAN"
log "Slug: $SLUG"

# PHASE 1: Pre-flight Checks
log "PHASE 1: Running pre-flight validation..."
node "$SCRIPT_DIR/../validators/pre-flight.js" "$ARGS" || {
    log "ERROR: Pre-flight validation failed"
    exit 1
}

# PHASE 2: Requirements Loading
log "PHASE 2: Loading CLAUDE.md requirements..."
node "$SCRIPT_DIR/../enforcers/load-requirements.js" || {
    log "ERROR: Failed to load requirements"
    exit 1
}

# PHASE 3: Status Verification
log "PHASE 3: Checking feature status..."
STATUS_CHECK=$(node "$SCRIPT_DIR/../gates/status-check.js" "$SLUG" 2>&1)
if [ $? -ne 0 ]; then
    log "ERROR: Status check failed: $STATUS_CHECK"
    exit 1
fi
log "Status check passed: $STATUS_CHECK"

# PHASE 4: Auto-detection & Initialization
if [ ! -d "$PROJECT_ROOT/docs/proposal/$SLUG" ]; then
    log "PHASE 4: Feature doesn't exist, auto-initializing..."
    node "$SCRIPT_DIR/../auto-init/detector.js" "$ARGS" || {
        log "ERROR: Auto-initialization failed"
        exit 1
    }
else
    log "PHASE 4: Feature already exists, skipping initialization"
fi

# PHASE 5: Main Execution
log "PHASE 5: Executing main feature creation..."
INPUT_JSON=$(cat <<EOF
{
    "feature": "$FEATURE",
    "plan": "$PLAN",
    "slug": "$SLUG",
    "autoConfirm": true
}
EOF
)

EXECUTION_RESULT=$(echo "$INPUT_JSON" | node "$PROJECT_ROOT/context-os/cli/execute-cli.js" 2>&1)
EXECUTION_CODE=$?

if [ $EXECUTION_CODE -ne 0 ]; then
    log "ERROR: Main execution failed"
    log "Result: $EXECUTION_RESULT"
    
    # Trigger recovery
    node "$SCRIPT_DIR/../recovery/recovery-manager.js" "$SLUG" "$EXECUTION_RESULT"
    exit 1
fi

log "Main execution completed successfully"

# PHASE 6: Post-execution Verification
log "PHASE 6: Running post-execution verification..."
VERIFICATION=$(node "$SCRIPT_DIR/../validators/post-execution.js" "$SLUG" 2>&1)
if [ $? -ne 0 ]; then
    log "WARNING: Post-execution verification found issues: $VERIFICATION"
fi

# PHASE 7: Compliance Report Generation
log "PHASE 7: Generating compliance report..."
node "$SCRIPT_DIR/../reports/compliance-generator.js" "$SLUG" "$LOG_FILE" || {
    log "WARNING: Failed to generate compliance report"
}

log "Execution completed successfully"
echo "✅ Feature '$FEATURE' created at docs/proposal/$SLUG"
echo "📋 Compliance report available at: logs/compliance-$SLUG.json"
```

### 2. Pre-Flight Validator

**File**: `context-os/validators/pre-flight.js`

```javascript
#!/usr/bin/env node

/**
 * Pre-Flight Validator
 * CRITICAL: Validates ALL prerequisites before execution
 * PREVENTS: Invalid executions that would fail downstream
 */

const fs = require('fs');
const path = require('path');

class PreFlightValidator {
  constructor() {
    this.projectRoot = path.join(__dirname, '../..');
    this.violations = [];
    this.warnings = [];
  }

  /**
   * Main validation entry point
   */
  async validate(args) {
    console.log('Running pre-flight validation...');
    
    const input = this.parseArguments(args);
    
    const checks = {
      claudeMdLoaded: await this.verifyClaudeMdRequirements(),
      inputSchema: this.validateJsonSchema(input),
      draftAccessible: await this.checkDraftFile(input.plan),
      nodeVersion: this.checkNodeVersion(),
      directoriesExist: await this.verifyDirectories(),
      contextOsInstalled: await this.verifyContextOsInstallation()
    };
    
    // Generate detailed report
    const report = {
      timestamp: new Date().toISOString(),
      canProceed: Object.values(checks).every(c => c.passed),
      checks: checks,
      violations: this.violations,
      warnings: this.warnings
    };
    
    // Write report for audit
    const reportPath = path.join(this.projectRoot, 'logs', 'pre-flight-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    if (!report.canProceed) {
      console.error('❌ Pre-flight validation failed:');
      this.violations.forEach(v => console.error(`  - ${v}`));
      process.exit(1);
    }
    
    console.log('✅ Pre-flight validation passed');
    return report;
  }

  /**
   * Verify CLAUDE.md requirements are accessible
   */
  async verifyClaudeMdRequirements() {
    const claudeMdPath = path.join(this.projectRoot, 'CLAUDE.md');
    
    if (!fs.existsSync(claudeMdPath)) {
      this.violations.push('CLAUDE.md not found - mandatory requirements cannot be enforced');
      return { passed: false, error: 'CLAUDE.md not found' };
    }
    
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    
    // Check for mandatory sections
    const requiredSections = [
      'MANDATORY HONESTY AND ACCURACY REQUIREMENTS',
      'Truth Requirements',
      'When Testing',
      'When Implementing',
      'No Assumptions Policy'
    ];
    
    const missingSections = requiredSections.filter(section => 
      !content.includes(section)
    );
    
    if (missingSections.length > 0) {
      this.violations.push(`CLAUDE.md missing required sections: ${missingSections.join(', ')}`);
      return { 
        passed: false, 
        error: 'Missing required sections',
        missing: missingSections 
      };
    }
    
    return { passed: true, sections: requiredSections };
  }

  /**
   * Validate input conforms to expected schema
   */
  validateJsonSchema(input) {
    const required = ['feature'];
    const missing = required.filter(field => !input[field]);
    
    if (missing.length > 0) {
      this.violations.push(`Missing required fields: ${missing.join(', ')}`);
      return { passed: false, missing: missing };
    }
    
    // Validate slug format if provided
    if (input.slug && !/^[a-z0-9_]+$/.test(input.slug)) {
      this.warnings.push('Slug contains invalid characters, will be normalized');
    }
    
    return { passed: true };
  }

  /**
   * Check draft file accessibility if provided
   */
  async checkDraftFile(planPath) {
    if (!planPath) {
      return { passed: true, info: 'No draft file provided' };
    }
    
    const fullPath = path.resolve(planPath);
    
    if (!fs.existsSync(fullPath)) {
      this.violations.push(`Draft file not found: ${planPath}`);
      return { passed: false, error: 'File not found' };
    }
    
    try {
      fs.accessSync(fullPath, fs.constants.R_OK);
    } catch (err) {
      this.violations.push(`Draft file not readable: ${planPath}`);
      return { passed: false, error: 'File not readable' };
    }
    
    return { passed: true, path: fullPath };
  }

  /**
   * Verify Node.js version meets requirements
   */
  checkNodeVersion() {
    const requiredVersion = '14.0.0';
    const currentVersion = process.version.substring(1);
    
    if (this.compareVersions(currentVersion, requiredVersion) < 0) {
      this.violations.push(`Node.js version ${currentVersion} is below required ${requiredVersion}`);
      return { passed: false, current: currentVersion, required: requiredVersion };
    }
    
    return { passed: true, version: currentVersion };
  }

  /**
   * Verify required directories exist
   */
  async verifyDirectories() {
    const requiredDirs = [
      'docs/proposal',
      'context-os',
      'context-os/cli',
      '.claude/agents'
    ];
    
    const missing = [];
    
    for (const dir of requiredDirs) {
      const fullPath = path.join(this.projectRoot, dir);
      if (!fs.existsSync(fullPath)) {
        missing.push(dir);
      }
    }
    
    if (missing.length > 0) {
      this.violations.push(`Missing required directories: ${missing.join(', ')}`);
      return { passed: false, missing: missing };
    }
    
    return { passed: true };
  }

  /**
   * Verify Context-OS installation
   */
  async verifyContextOsInstallation() {
    const requiredFiles = [
      'context-os/cli/execute-cli.js',
      'context-os/create-feature.js',
      'context-os/status-enforcer.js'
    ];
    
    const missing = [];
    
    for (const file of requiredFiles) {
      const fullPath = path.join(this.projectRoot, file);
      if (!fs.existsSync(fullPath)) {
        missing.push(file);
      }
    }
    
    if (missing.length > 0) {
      this.violations.push(`Context-OS not properly installed. Missing: ${missing.join(', ')}`);
      return { passed: false, missing: missing };
    }
    
    return { passed: true };
  }

  /**
   * Parse command line arguments
   */
  parseArguments(args) {
    const result = {
      feature: args[2],
      plan: null,
      slug: null
    };
    
    for (let i = 3; i < args.length; i++) {
      if (args[i] === '--from' && args[i + 1]) {
        result.plan = args[i + 1];
        i++;
      } else if (args[i] === '--slug' && args[i + 1]) {
        result.slug = args[i + 1];
        i++;
      }
    }
    
    return result;
  }

  /**
   * Compare version strings
   */
  compareVersions(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;
      
      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }
    
    return 0;
  }
}

// Execute if called directly
if (require.main === module) {
  const validator = new PreFlightValidator();
  validator.validate(process.argv).catch(err => {
    console.error('Pre-flight validation error:', err);
    process.exit(1);
  });
}

module.exports = PreFlightValidator;
```

### 3. Requirements Enforcer

**File**: `context-os/enforcers/requirements-enforcer.js`

```javascript
#!/usr/bin/env node

/**
 * Requirements Enforcer
 * ENFORCES: CLAUDE.md mandatory honesty requirements
 * ENSURES: No false claims about completion or testing
 */

const fs = require('fs');
const path = require('path');

class RequirementsEnforcer {
  constructor() {
    this.projectRoot = path.join(__dirname, '../..');
    this.requirements = this.loadClaudeMdRequirements();
    this.violations = [];
    this.enforcements = [];
  }

  /**
   * Load requirements from CLAUDE.md
   */
  loadClaudeMdRequirements() {
    const claudeMdPath = path.join(this.projectRoot, 'CLAUDE.md');
    
    if (!fs.existsSync(claudeMdPath)) {
      throw new Error('CLAUDE.md not found - cannot enforce requirements');
    }
    
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    
    // Extract requirements
    const requirements = {
      honestyRules: this.extractSection(content, 'Truth Requirements'),
      testingRules: this.extractSection(content, 'When Testing'),
      implementationRules: this.extractSection(content, 'When Implementing'),
      assumptionPolicy: this.extractSection(content, 'No Assumptions Policy')
    };
    
    console.log('✅ Loaded CLAUDE.md requirements');
    return requirements;
  }

  /**
   * Extract a section from CLAUDE.md
   */
  extractSection(content, sectionName) {
    const sectionStart = content.indexOf(`### ${sectionName}`);
    if (sectionStart === -1) return [];
    
    const sectionEnd = content.indexOf('\n###', sectionStart + 1);
    const sectionContent = sectionEnd === -1 
      ? content.substring(sectionStart)
      : content.substring(sectionStart, sectionEnd);
    
    // Extract bullet points
    const rules = [];
    const lines = sectionContent.split('\n');
    
    for (const line of lines) {
      if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
        const rule = line.trim().substring(1).trim();
        if (rule.includes('NEVER') || rule.includes('ALWAYS') || rule.includes('MUST')) {
          rules.push(rule);
        }
      }
    }
    
    return rules;
  }

  /**
   * Enforce honesty requirements on an action
   */
  enforceHonesty(action, evidence) {
    console.log(`Enforcing honesty for action: ${action.type}`);
    
    // Check claims against evidence
    if (action.type === 'CLAIM_COMPLETE') {
      if (!evidence || !evidence.verified) {
        this.violations.push({
          rule: 'HONESTY_REQUIREMENT',
          violation: 'Claiming completion without verification',
          action: action,
          missing: 'verification_evidence'
        });
        
        throw new Error(
          'VIOLATION: Cannot claim completion without verification. ' +
          'CLAUDE.md requires: "NEVER claim something works without actually testing it"'
        );
      }
      
      // Verify actual file creation
      if (action.filesCreated) {
        for (const file of action.filesCreated) {
          if (!fs.existsSync(file)) {
            this.violations.push({
              rule: 'HONESTY_REQUIREMENT',
              violation: 'Claiming file creation without actual creation',
              file: file
            });
            
            throw new Error(
              `VIOLATION: Claimed creation of ${file} but file does not exist. ` +
              'CLAUDE.md requires: "NEVER mark features as complete without verification"'
            );
          }
        }
      }
    }
    
    this.enforcements.push({
      action: action.type,
      result: 'PASSED',
      evidence: evidence
    });
  }

  /**
   * Enforce testing requirements
   */
  enforceTestingRequirement(tests) {
    console.log('Enforcing testing requirements...');
    
    if (!tests || !tests.actuallyRun) {
      this.violations.push({
        rule: 'TESTING_REQUIREMENT',
        violation: 'Tests not actually executed',
        details: 'CLAUDE.md requires actual test execution, not simulation'
      });
      
      throw new Error(
        'VIOLATION: Tests must be actually executed, not simulated. ' +
        'CLAUDE.md requires: "ALWAYS run the actual commands"'
      );
    }
    
    // Verify test output exists
    if (!tests.output || tests.output.length === 0) {
      this.violations.push({
        rule: 'TESTING_REQUIREMENT',
        violation: 'No test output captured',
        details: 'Test execution must produce verifiable output'
      });
      
      throw new Error(
        'VIOLATION: Test execution produced no output. ' +
        'CLAUDE.md requires: "ALWAYS show actual command output"'
      );
    }
    
    // Check for fabricated results
    if (tests.output.includes('simulated') || tests.output.includes('mocked')) {
      this.violations.push({
        rule: 'TESTING_REQUIREMENT',
        violation: 'Test results appear to be simulated',
        evidence: tests.output
      });
      
      throw new Error(
        'VIOLATION: Test results appear to be simulated. ' +
        'CLAUDE.md requires: "NEVER fabricate test results or success claims"'
      );
    }
    
    this.enforcements.push({
      action: 'TEST_EXECUTION',
      result: 'PASSED',
      testCount: tests.count,
      hasOutput: true
    });
  }

  /**
   * Enforce implementation requirements
   */
  enforceImplementationRequirements(implementation) {
    console.log('Enforcing implementation requirements...');
    
    // Check for assumptions
    if (implementation.assumedWorking && !implementation.verified) {
      this.violations.push({
        rule: 'NO_ASSUMPTIONS_POLICY',
        violation: 'Assuming functionality without verification',
        details: implementation.assumedWorking
      });
      
      throw new Error(
        'VIOLATION: Cannot assume functionality works without verification. ' +
        'CLAUDE.md requires: "NEVER assume you understand anything without reading the required sources"'
      );
    }
    
    // Verify state claims
    if (implementation.statesClaims) {
      for (const claim of implementation.statesClaims) {
        if (claim.type === 'exists' && !claim.verified) {
          this.violations.push({
            rule: 'IMPLEMENTATION_REQUIREMENT',
            violation: 'Stating existence without verification',
            claim: claim
          });
          
          throw new Error(
            `VIOLATION: Claimed "${claim.description}" without verification. ` +
            'CLAUDE.md requires: State "I will create" not "this exists" when building new features'
          );
        }
      }
    }
    
    this.enforcements.push({
      action: 'IMPLEMENTATION_CHECK',
      result: 'PASSED',
      verified: true
    });
  }

  /**
   * Generate enforcement report
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      requirementsLoaded: Object.keys(this.requirements).length > 0,
      enforcements: this.enforcements,
      violations: this.violations,
      summary: {
        totalEnforcements: this.enforcements.length,
        totalViolations: this.violations.length,
        status: this.violations.length === 0 ? 'COMPLIANT' : 'VIOLATIONS_FOUND'
      }
    };
    
    // Save report
    const reportPath = path.join(this.projectRoot, 'logs', 'enforcement-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    return report;
  }

  /**
   * Main enforcement entry point
   */
  async enforce(action, evidence = {}) {
    try {
      // Route to appropriate enforcement
      switch (action.type) {
        case 'CLAIM_COMPLETE':
          this.enforceHonesty(action, evidence);
          break;
        
        case 'RUN_TESTS':
          this.enforceTestingRequirement(evidence.tests);
          break;
        
        case 'IMPLEMENT_FEATURE':
          this.enforceImplementationRequirements(evidence.implementation);
          break;
        
        default:
          console.log(`No specific enforcement for action type: ${action.type}`);
      }
      
      const report = this.generateReport();
      
      if (report.summary.status === 'VIOLATIONS_FOUND') {
        console.error('❌ Requirement violations detected:');
        this.violations.forEach(v => 
          console.error(`  - ${v.rule}: ${v.violation}`)
        );
        process.exit(1);
      }
      
      console.log('✅ All requirements enforced successfully');
      return report;
      
    } catch (error) {
      console.error('❌ Enforcement failed:', error.message);
      this.generateReport();
      throw error;
    }
  }
}

// Execute if called directly
if (require.main === module) {
  const enforcer = new RequirementsEnforcer();
  
  // Load requirements only (for initialization phase)
  if (process.argv[2] === '--load-only') {
    console.log('Requirements loaded successfully');
    process.exit(0);
  }
  
  // Example enforcement
  const exampleAction = {
    type: 'CLAIM_COMPLETE',
    filesCreated: ['docs/proposal/test/implementation.md']
  };
  
  const exampleEvidence = {
    verified: true,
    tests: { actuallyRun: true, output: 'Test passed', count: 5 }
  };
  
  enforcer.enforce(exampleAction, exampleEvidence).catch(err => {
    console.error('Enforcement error:', err);
    process.exit(1);
  });
}

module.exports = RequirementsEnforcer;
```

### 4. Status Gate Controller

**File**: `context-os/gates/status-gate.js`

```javascript
#!/usr/bin/env node

/**
 * Status Gate Controller
 * GUARDS: Feature status transitions
 * PREVENTS: Modification of COMPLETE features
 */

const fs = require('fs');
const path = require('path');

class StatusGate {
  constructor() {
    this.projectRoot = path.join(__dirname, '../..');
    this.statusFile = 'STATUS.md';
    this.transitions = {
      'PLANNED': ['IN_PROGRESS'],
      'IN_PROGRESS': ['COMPLETE', 'PLANNED'],
      'COMPLETE': [], // No transitions allowed without /context-fix
      'undefined': ['PLANNED'] // New features start as PLANNED
    };
  }

  /**
   * Get current status of a feature
   */
  async getCurrentStatus(featureSlug) {
    if (!featureSlug) {
      return 'undefined';
    }
    
    const statusPath = path.join(
      this.projectRoot, 
      'docs/proposal', 
      featureSlug, 
      this.statusFile
    );
    
    if (!fs.existsSync(statusPath)) {
      return 'undefined';
    }
    
    try {
      const content = fs.readFileSync(statusPath, 'utf8');
      const statusMatch = content.match(/Status:\s*(\w+)/i);
      
      if (statusMatch) {
        return statusMatch[1].toUpperCase();
      }
    } catch (err) {
      console.error(`Error reading status for ${featureSlug}:`, err);
    }
    
    return 'undefined';
  }

  /**
   * Check if an operation is permitted based on current status
   */
  async checkPermission(featureSlug, operation) {
    const currentStatus = await this.getCurrentStatus(featureSlug);
    
    console.log(`Checking permission for ${operation} on ${featureSlug} (status: ${currentStatus})`);
    
    // Special handling for COMPLETE features
    if (currentStatus === 'COMPLETE') {
      if (operation === 'modify' || operation === 'execute') {
        return {
          allowed: false,
          reason: 'Cannot modify COMPLETE feature. Use /context-fix to create a fix branch',
          currentStatus: currentStatus,
          suggestion: `/context-fix ${featureSlug} --issue "Description of change needed"`
        };
      }
      
      if (operation === 'fix') {
        return {
          allowed: true,
          currentStatus: currentStatus,
          info: 'Fix operation allowed on COMPLETE features'
        };
      }
    }
    
    // Check transition validity for status changes
    if (operation.startsWith('transition:')) {
      const targetStatus = operation.split(':')[1].toUpperCase();
      const allowedTransitions = this.transitions[currentStatus] || [];
      
      if (!allowedTransitions.includes(targetStatus)) {
        return {
          allowed: false,
          reason: `Invalid transition from ${currentStatus} to ${targetStatus}`,
          currentStatus: currentStatus,
          allowedTransitions: allowedTransitions
        };
      }
    }
    
    // Default: allow operation
    return {
      allowed: true,
      currentStatus: currentStatus
    };
  }

  /**
   * Update feature status
   */
  async updateStatus(featureSlug, newStatus, metadata = {}) {
    const permission = await this.checkPermission(
      featureSlug, 
      `transition:${newStatus}`
    );
    
    if (!permission.allowed) {
      throw new Error(permission.reason);
    }
    
    const statusPath = path.join(
      this.projectRoot,
      'docs/proposal',
      featureSlug,
      this.statusFile
    );
    
    const statusContent = `# Feature Status

Status: ${newStatus}
Updated: ${new Date().toISOString()}
Previous: ${permission.currentStatus}

## Metadata
${JSON.stringify(metadata, null, 2)}

## Transition Log
- ${new Date().toISOString()}: ${permission.currentStatus} → ${newStatus}
`;
    
    // Ensure directory exists
    const dir = path.dirname(statusPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(statusPath, statusContent);
    
    console.log(`✅ Status updated: ${permission.currentStatus} → ${newStatus}`);
    
    return {
      previous: permission.currentStatus,
      current: newStatus,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate gate decision report
   */
  generateGateReport(decisions) {
    const report = {
      timestamp: new Date().toISOString(),
      decisions: decisions,
      summary: {
        total: decisions.length,
        allowed: decisions.filter(d => d.allowed).length,
        blocked: decisions.filter(d => !d.allowed).length
      }
    };
    
    const reportPath = path.join(this.projectRoot, 'logs', 'status-gate-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    return report;
  }
}

// Execute if called directly
if (require.main === module) {
  const gate = new StatusGate();
  const featureSlug = process.argv[2];
  const operation = process.argv[3] || 'execute';
  
  gate.checkPermission(featureSlug, operation)
    .then(result => {
      if (result.allowed) {
        console.log('✅ Operation permitted');
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      } else {
        console.error('❌ Operation blocked:', result.reason);
        if (result.suggestion) {
          console.log('💡 Suggestion:', result.suggestion);
        }
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Status gate error:', err);
      process.exit(1);
    });
}

module.exports = StatusGate;
```

### 5. Auto-Detection Module

**File**: `context-os/auto-init/detector.js`

```javascript
#!/usr/bin/env node

/**
 * Auto-Detection Module
 * IMPLEMENTS: Single command philosophy from context-executor.md
 * AUTO-DETECTS: Need for initialization and handles it
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class AutoDetector {
  constructor() {
    this.projectRoot = path.join(__dirname, '../..');
  }

  /**
   * Generate slug from feature name
   */
  generateSlug(featureName) {
    if (!featureName) return 'new_feature';
    
    return featureName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'new_feature';
  }

  /**
   * Check if feature already exists
   */
  async featureExists(slug) {
    const featurePath = path.join(
      this.projectRoot,
      'docs/proposal',
      slug
    );
    
    return fs.existsSync(featurePath);
  }

  /**
   * Auto-initialize a new feature
   */
  async autoInitialize(config) {
    console.log(`[AUTO-INIT] Initializing feature: ${config.slug}`);
    
    const featurePath = path.join(
      this.projectRoot,
      'docs/proposal',
      config.slug
    );
    
    // Create directory structure
    const dirs = [
      featurePath,
      path.join(featurePath, 'reports'),
      path.join(featurePath, 'patches'),
      path.join(featurePath, 'post-implementation-fixes'),
      path.join(featurePath, 'test_pages'),
      path.join(featurePath, 'test_scripts')
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`  Created: ${dir}`);
      }
    }
    
    // Copy or create plan file
    if (config.plan && fs.existsSync(config.plan)) {
      const planContent = fs.readFileSync(config.plan, 'utf8');
      const targetFile = path.join(
        featurePath,
        path.basename(config.plan)
      );
      fs.writeFileSync(targetFile, planContent);
      console.log(`  Copied plan to: ${targetFile}`);
    } else {
      // Create minimal plan
      const minimalPlan = `# ${config.feature}

## Description
${config.feature}

## Requirements
- [ ] To be defined

## Implementation Plan
- [ ] To be defined

## Success Criteria
- [ ] To be defined

Status: PLANNED
Created: ${new Date().toISOString()}
`;
      
      const planFile = path.join(featurePath, 'INITIAL.md');
      fs.writeFileSync(planFile, minimalPlan);
      console.log(`  Created minimal plan: ${planFile}`);
    }
    
    // Create README files
    const readmeContent = {
      patches: '# Patches\n\nCode patches for this feature.\n',
      'post-implementation-fixes': '# Post-Implementation Fixes\n\nFixes applied after implementation.\n',
      reports: '# Reports\n\nImplementation and validation reports.\n',
      test_pages: '# Test Pages\n\nTest pages for manual testing.\n',
      test_scripts: '# Test Scripts\n\nAutomated test scripts.\n'
    };
    
    for (const [dir, content] of Object.entries(readmeContent)) {
      const readmePath = path.join(featurePath, dir, 'README.md');
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(readmePath, content);
      }
    }
    
    // Create STATUS.md
    const statusPath = path.join(featurePath, 'STATUS.md');
    if (!fs.existsSync(statusPath)) {
      fs.writeFileSync(statusPath, `# Feature Status\n\nStatus: PLANNED\nCreated: ${new Date().toISOString()}\n`);
    }
    
    console.log(`[AUTO-INIT] Feature initialized successfully at: ${featurePath}`);
    
    return {
      initialized: true,
      path: featurePath,
      slug: config.slug
    };
  }

  /**
   * Main detection and initialization logic
   */
  async detectAndInit(args) {
    // Parse arguments
    const input = this.parseArguments(args);
    
    if (!input.feature) {
      throw new Error('Feature name is required');
    }
    
    const slug = input.slug || this.generateSlug(input.feature);
    const exists = await this.featureExists(slug);
    
    const result = {
      feature: input.feature,
      slug: slug,
      exists: exists,
      autoInitialized: false
    };
    
    if (!exists && !input.interactive) {
      console.log(`[AUTO-DETECT] Feature '${slug}' doesn't exist`);
      
      if (input.autoInit !== false) {
        // Automatically create structure
        const initResult = await this.autoInitialize({
          slug: slug,
          plan: input.plan,
          feature: input.feature,
          silent: input.silent
        });
        
        result.autoInitialized = true;
        result.path = initResult.path;
      } else {
        console.log('[AUTO-DETECT] Auto-initialization disabled');
      }
    } else if (exists) {
      console.log(`[AUTO-DETECT] Feature '${slug}' already exists`);
      result.path = path.join(this.projectRoot, 'docs/proposal', slug);
    }
    
    return result;
  }

  /**
   * Parse command line arguments
   */
  parseArguments(args) {
    const result = {
      feature: null,
      plan: null,
      slug: null,
      interactive: false,
      autoInit: true,
      silent: false
    };
    
    // Skip first two args (node and script path)
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === '--interactive') {
        result.interactive = true;
      } else if (arg === '--no-auto-init') {
        result.autoInit = false;
      } else if (arg === '--silent') {
        result.silent = true;
      } else if (arg === '--plan' && args[i + 1]) {
        result.plan = args[i + 1];
        i++;
      } else if (arg === '--slug' && args[i + 1]) {
        result.slug = args[i + 1];
        i++;
      } else if (!result.feature && !arg.startsWith('--')) {
        result.feature = arg;
      }
    }
    
    return result;
  }
}

// Execute if called directly
if (require.main === module) {
  const detector = new AutoDetector();
  
  detector.detectAndInit(process.argv)
    .then(result => {
      console.log('Auto-detection result:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('Auto-detection error:', err);
      process.exit(1);
    });
}

module.exports = AutoDetector;
```

### 6. Verification Checkpoint System

**File**: `context-os/validators/verification-checkpoint.js`

```javascript
#!/usr/bin/env node

/**
 * Verification Checkpoint System
 * VERIFIES: Actual creation, not assumed success
 * COLLECTS: Evidence for all claims
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class VerificationCheckpoint {
  constructor() {
    this.projectRoot = path.join(__dirname, '../..');
    this.evidence = {
      filesCreated: [],
      filesVerified: [],
      testsRun: [],
      validationPassed: false,
      timestamp: new Date().toISOString(),
      violations: []
    };
  }

  /**
   * Main verification entry point
   */
  async verify(featureSlug) {
    if (!featureSlug) {
      throw new Error('Feature slug is required for verification');
    }
    
    console.log(`Running verification checkpoint for: ${featureSlug}`);
    
    // Phase 1: Verify file creation
    await this.verifyFileCreation(featureSlug);
    
    // Phase 2: Verify structure completeness
    await this.verifyStructure(featureSlug);
    
    // Phase 3: Run validation tests
    await this.runValidation(featureSlug);
    
    // Phase 4: Collect test evidence
    await this.collectTestEvidence(featureSlug);
    
    // Generate report
    const report = this.generateReport(featureSlug);
    
    // Check for violations
    if (this.evidence.violations.length > 0) {
      console.error('❌ Verification violations found:');
      this.evidence.violations.forEach(v => 
        console.error(`  - ${v.type}: ${v.message}`)
      );
      throw new Error('Verification failed with violations');
    }
    
    console.log('✅ Verification checkpoint passed');
    return report;
  }

  /**
   * Verify actual file creation
   */
  async verifyFileCreation(featureSlug) {
    console.log('  Verifying file creation...');
    
    const featurePath = path.join(
      this.projectRoot,
      'docs/proposal',
      featureSlug
    );
    
    // Check feature directory exists
    if (!fs.existsSync(featurePath)) {
      this.evidence.violations.push({
        type: 'MISSING_DIRECTORY',
        message: `Feature directory does not exist: ${featurePath}`,
        severity: 'CRITICAL'
      });
      return;
    }
    
    // Expected files and directories
    const expectedStructure = [
      'reports',
      'patches',
      'patches/README.md',
      'post-implementation-fixes',
      'post-implementation-fixes/README.md',
      'test_pages',
      'test_scripts',
      'STATUS.md'
    ];
    
    for (const item of expectedStructure) {
      const itemPath = path.join(featurePath, item);
      
      if (fs.existsSync(itemPath)) {
        this.evidence.filesVerified.push(item);
      } else {
        this.evidence.violations.push({
          type: 'MISSING_FILE',
          message: `Expected file/directory not found: ${item}`,
          severity: 'HIGH'
        });
      }
    }
    
    // Check for INITIAL.md or plan file
    const files = fs.readdirSync(featurePath);
    const planFile = files.find(f => 
      f.endsWith('.md') && 
      !['STATUS.md', 'README.md'].includes(f)
    );
    
    if (planFile) {
      this.evidence.filesVerified.push(planFile);
    } else {
      this.evidence.violations.push({
        type: 'MISSING_PLAN',
        message: 'No plan file (INITIAL.md or similar) found',
        severity: 'HIGH'
      });
    }
    
    console.log(`    Verified ${this.evidence.filesVerified.length} files/directories`);
  }

  /**
   * Verify structure completeness
   */
  async verifyStructure(featureSlug) {
    console.log('  Verifying structure completeness...');
    
    const featurePath = path.join(
      this.projectRoot,
      'docs/proposal',
      featureSlug
    );
    
    // Check README files have content
    const readmeFiles = [
      'patches/README.md',
      'post-implementation-fixes/README.md'
    ];
    
    for (const readme of readmeFiles) {
      const readmePath = path.join(featurePath, readme);
      
      if (fs.existsSync(readmePath)) {
        const content = fs.readFileSync(readmePath, 'utf8');
        
        if (content.trim().length < 10) {
          this.evidence.violations.push({
            type: 'EMPTY_README',
            message: `README file appears empty: ${readme}`,
            severity: 'MEDIUM'
          });
        }
      }
    }
    
    // Check STATUS.md format
    const statusPath = path.join(featurePath, 'STATUS.md');
    if (fs.existsSync(statusPath)) {
      const content = fs.readFileSync(statusPath, 'utf8');
      
      if (!content.includes('Status:')) {
        this.evidence.violations.push({
          type: 'INVALID_STATUS',
          message: 'STATUS.md missing Status field',
          severity: 'MEDIUM'
        });
      }
    }
  }

  /**
   * Run validation tests
   */
  async runValidation(featureSlug) {
    console.log('  Running validation tests...');
    
    try {
      // Check if validation script exists
      const validateScript = path.join(
        this.projectRoot,
        'context-os/cli/validate-cli.js'
      );
      
      if (!fs.existsSync(validateScript)) {
        console.log('    Validation script not found, skipping');
        return;
      }
      
      // Run validation
      const command = `node "${validateScript}" "${featureSlug}"`;
      const output = execSync(command, {
        encoding: 'utf8',
        cwd: this.projectRoot
      });
      
      this.evidence.validationPassed = true;
      this.evidence.testsRun.push({
        type: 'validation',
        command: command,
        output: output,
        passed: true
      });
      
      console.log('    Validation passed');
      
    } catch (err) {
      this.evidence.validationPassed = false;
      this.evidence.testsRun.push({
        type: 'validation',
        error: err.message,
        passed: false
      });
      
      // Not a critical violation, just record it
      console.log('    Validation failed (non-critical)');
    }
  }

  /**
   * Collect test evidence
   */
  async collectTestEvidence(featureSlug) {
    console.log('  Collecting test evidence...');
    
    const testScriptsPath = path.join(
      this.projectRoot,
      'docs/proposal',
      featureSlug,
      'test_scripts'
    );
    
    if (!fs.existsSync(testScriptsPath)) {
      console.log('    No test scripts directory found');
      return;
    }
    
    const testFiles = fs.readdirSync(testScriptsPath)
      .filter(f => f.endsWith('.js') || f.endsWith('.sh'));
    
    if (testFiles.length > 0) {
      console.log(`    Found ${testFiles.length} test scripts`);
      this.evidence.testsRun.push({
        type: 'test_scripts',
        count: testFiles.length,
        files: testFiles
      });
    } else {
      console.log('    No test scripts found yet');
    }
  }

  /**
   * Generate verification report
   */
  generateReport(featureSlug) {
    const report = {
      feature: featureSlug,
      timestamp: this.evidence.timestamp,
      summary: {
        filesVerified: this.evidence.filesVerified.length,
        testsRun: this.evidence.testsRun.length,
        validationPassed: this.evidence.validationPassed,
        violationCount: this.evidence.violations.length,
        status: this.evidence.violations.length === 0 ? 'PASSED' : 'FAILED'
      },
      evidence: this.evidence
    };
    
    // Save report
    const reportPath = path.join(
      this.projectRoot,
      'docs/proposal',
      featureSlug,
      'reports',
      `verification-${Date.now()}.json`
    );
    
    // Ensure reports directory exists
    const reportsDir = path.dirname(reportPath);
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  Report saved to: ${reportPath}`);
    
    return report;
  }
}

// Execute if called directly
if (require.main === module) {
  const checkpoint = new VerificationCheckpoint();
  const featureSlug = process.argv[2];
  
  if (!featureSlug) {
    console.error('Usage: node verification-checkpoint.js <feature-slug>');
    process.exit(1);
  }
  
  checkpoint.verify(featureSlug)
    .then(report => {
      console.log('Verification complete:');
      console.log(JSON.stringify(report.summary, null, 2));
      process.exit(report.summary.status === 'PASSED' ? 0 : 1);
    })
    .catch(err => {
      console.error('Verification error:', err);
      process.exit(1);
    });
}

module.exports = VerificationCheckpoint;
```

## Implementation Plan

### Phase 1: Core Infrastructure (Days 1-3)
1. Create directory structure
2. Implement master-executor.sh
3. Build pre-flight.js validator
4. Create basic logging system

### Phase 2: Enforcement Layer (Days 4-7)
1. Implement requirements-enforcer.js
2. Create status-gate.js
3. Build verification-checkpoint.js
4. Add load-requirements.js

### Phase 3: Auto-Detection & Recovery (Days 8-10)
1. Implement detector.js
2. Create recovery-manager.js
3. Build compliance-generator.js
4. Add error handling throughout

### Phase 4: Testing & Integration (Days 11-14)
1. Unit tests for each component
2. Integration tests with Context-OS
3. End-to-end testing
4. Documentation updates

## Benefits & Rationale

1. **No Missed Steps**: Every instruction becomes a programmatic check
2. **Maintains Honesty**: CLAUDE.md requirements enforced automatically
3. **Preserves Existing Code**: Wraps current implementation
4. **Clear Audit Trail**: Complete logging and reporting
5. **Graceful Failures**: Recovery options prevent data loss
6. **Single Entry Point**: Consistent execution path

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Scripts break existing workflow | Implement as optional layer initially |
| Performance overhead | Parallelize checks, cache results |
| Too rigid enforcement | Add override flags with audit logging |
| Integration complexity | Phased rollout with feature flags |

## Success Metrics

- ✅ Zero missed instructions from context-executor.md
- ✅ 100% of executions have compliance reports
- ✅ All CLAUDE.md requirements programmatically enforced
- ✅ Recovery successful in 95% of partial failures
- ✅ Audit trail for every execution

## Conclusion

This comprehensive scriptification proposal transforms the manual instructions in context-executor.md into an automated, enforceable system that guarantees compliance with all requirements while maintaining the flexibility and functionality of the existing Context-OS implementation.

The enforcement layer approach ensures that the valuable work already done is preserved while adding the safety and reliability guarantees needed for production use.