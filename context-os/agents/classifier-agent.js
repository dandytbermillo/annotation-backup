#!/usr/bin/env node

/**
 * ClassifierAgent - Categorizes issues and determines appropriate workflows
 * Part of Context-OS orchestration system
 */

const fs = require('fs');
const path = require('path');

class ClassifierAgent {
  constructor() {
    this.severityLevels = {
      CRITICAL: {
        icon: '🔴',
        priority: 1,
        description: 'Data loss, security, prod down, >50% perf degradation',
        directory: 'critical',
        sla: 'Immediate'
      },
      HIGH: {
        icon: '🟠',
        priority: 2,
        description: 'Memory leak >25%/day, 25-50% perf, >10% users affected',
        directory: 'high',
        sla: 'Within 24 hours'
      },
      MEDIUM: {
        icon: '🟡',
        priority: 3,
        description: '10-25% perf degradation, UX disrupted, non-critical broken',
        directory: 'medium',
        sla: 'Within 1 week'
      },
      LOW: {
        icon: '🟢',
        priority: 4,
        description: '<10% perf impact, cosmetic, code quality',
        directory: 'low',
        sla: 'As time permits'
      }
    };
    
    this.issueTypes = {
      BUG: {
        keywords: ['bug', 'error', 'crash', 'fail', 'broken', 'exception', 'undefined'],
        workflow: 'bug-fix'
      },
      PERFORMANCE: {
        keywords: ['slow', 'performance', 'memory', 'leak', 'optimization', 'latency'],
        workflow: 'performance-fix'
      },
      SECURITY: {
        keywords: ['security', 'vulnerability', 'exploit', 'injection', 'xss', 'csrf'],
        workflow: 'security-fix'
      },
      UX: {
        keywords: ['ui', 'ux', 'user experience', 'usability', 'accessibility', 'a11y'],
        workflow: 'ux-fix'
      },
      ENHANCEMENT: {
        keywords: ['enhance', 'improve', 'feature', 'add', 'new', 'request'],
        workflow: 'enhancement'
      }
    };
  }
  
  /**
   * Classify issue severity based on description and metrics
   */
  classifySeverity(issue) {
    const description = issue.description || '';
    const metrics = issue.metrics || {};
    
    // Critical indicators
    if (this.hasIndicators(description, ['data loss', 'security breach', 'production down', 'critical'])) {
      return 'CRITICAL';
    }
    if (metrics.performanceDegradation > 50 || metrics.usersAffected > 50) {
      return 'CRITICAL';
    }
    
    // High indicators
    if (this.hasIndicators(description, ['memory leak', 'high priority', 'urgent'])) {
      return 'HIGH';
    }
    if (metrics.performanceDegradation > 25 || metrics.usersAffected > 10) {
      return 'HIGH';
    }
    
    // Medium indicators
    if (this.hasIndicators(description, ['degradation', 'disrupted', 'moderate'])) {
      return 'MEDIUM';
    }
    if (metrics.performanceDegradation > 10 || metrics.usersAffected > 5) {
      return 'MEDIUM';
    }
    
    // Default to LOW
    return 'LOW';
  }
  
  /**
   * Classify issue type based on description
   */
  classifyType(issue) {
    const description = (issue.description || '').toLowerCase();
    const title = (issue.title || '').toLowerCase();
    const combined = `${title} ${description}`;
    
    // Check each type's keywords
    for (const [type, config] of Object.entries(this.issueTypes)) {
      if (config.keywords.some(keyword => combined.includes(keyword))) {
        return type;
      }
    }
    
    // Default to BUG if no match
    return 'BUG';
  }
  
  /**
   * Full classification with recommendations
   */
  classify(issue) {
    const severity = this.classifySeverity(issue);
    const type = this.classifyType(issue);
    const severityConfig = this.severityLevels[severity];
    const typeConfig = this.issueTypes[type];
    
    return {
      severity,
      type,
      priority: severityConfig.priority,
      icon: severityConfig.icon,
      directory: severityConfig.directory,
      sla: severityConfig.sla,
      workflow: typeConfig.workflow,
      recommendations: this.generateRecommendations(severity, type)
    };
  }
  
  /**
   * Generate workflow recommendations
   */
  generateRecommendations(severity, type) {
    const recommendations = [];
    
    // Severity-based recommendations
    if (severity === 'CRITICAL') {
      recommendations.push('⚠️  Immediate action required');
      recommendations.push('📞 Notify on-call engineer');
      recommendations.push('🔄 Consider rollback if recent deploy');
    } else if (severity === 'HIGH') {
      recommendations.push('📅 Schedule fix within 24 hours');
      recommendations.push('👥 Assign to senior developer');
    }
    
    // Type-based recommendations
    if (type === 'SECURITY') {
      recommendations.push('🔐 Conduct security review');
      recommendations.push('📝 Update security documentation');
      recommendations.push('🔍 Check for similar vulnerabilities');
    } else if (type === 'PERFORMANCE') {
      recommendations.push('📊 Profile and measure impact');
      recommendations.push('🧪 Add performance tests');
      recommendations.push('📈 Monitor after fix deployment');
    } else if (type === 'UX') {
      recommendations.push('🎨 Review with design team');
      recommendations.push('🧪 Conduct user testing');
    }
    
    return recommendations;
  }
  
  /**
   * Route issue to appropriate directory
   */
  routeIssue(issue, featurePath) {
    const classification = this.classify(issue);
    const fixDir = path.join(featurePath, 'post-implementation-fixes', classification.directory);
    
    // Ensure directory exists
    if (!fs.existsSync(fixDir)) {
      fs.mkdirSync(fixDir, { recursive: true });
    }
    
    // Generate fix filename
    const date = new Date().toISOString().split('T')[0];
    const slug = this.generateSlug(issue.title || issue.description);
    const filename = `${date}-${slug}.md`;
    const filepath = path.join(fixDir, filename);
    
    // Create fix document
    const content = this.generateFixDocument(issue, classification);
    fs.writeFileSync(filepath, content);
    
    return {
      path: filepath,
      classification
    };
  }
  
  /**
   * Generate fix document content
   */
  generateFixDocument(issue, classification) {
    const date = new Date().toISOString().split('T')[0];
    
    return `# ${issue.title || 'Fix Required'}

**Date Identified**: ${date}
**Severity**: ${classification.icon} ${classification.severity}
**Type**: ${classification.type}
**SLA**: ${classification.sla}
**Workflow**: ${classification.workflow}

## Issue Description
${issue.description || '[TO BE FILLED]'}

## Impact
- Performance: ${issue.metrics?.performanceDegradation || 'TBD'}%
- Users Affected: ${issue.metrics?.usersAffected || 'TBD'}%
- Environment: ${issue.environment || 'TBD'}

## Root Cause Analysis
[TO BE FILLED]

## Proposed Solution
[TO BE FILLED]

## Implementation Steps
1. [TO BE FILLED]
2. [TO BE FILLED]
3. [TO BE FILLED]

## Testing Plan
- [ ] Unit tests
- [ ] Integration tests
- [ ] Manual verification
- [ ] Performance testing (if applicable)

## Rollback Plan
[TO BE FILLED]

## Recommendations
${classification.recommendations.map(r => `- ${r}`).join('\n')}

## Status Tracking
- [ ] Issue identified
- [ ] Root cause analyzed
- [ ] Solution proposed
- [ ] Implementation started
- [ ] Testing completed
- [ ] Deployed to staging
- [ ] Deployed to production
- [ ] Monitoring confirmed

## Related Links
- Implementation Report: [../reports/](../reports/)
- Original Feature: [../../implementation.md](../../implementation.md)
`;
  }
  
  /**
   * Helper: Check for indicators
   */
  hasIndicators(text, indicators) {
    const lower = text.toLowerCase();
    return indicators.some(indicator => lower.includes(indicator));
  }
  
  /**
   * Helper: Generate slug from text
   */
  generateSlug(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }
  
  /**
   * Analyze all fixes in a feature
   */
  analyzeFeature(featurePath) {
    const fixesPath = path.join(featurePath, 'post-implementation-fixes');
    const stats = {
      total: 0,
      bySeverity: {},
      byType: {},
      byStatus: { open: 0, closed: 0 }
    };
    
    // Initialize counters
    for (const severity of Object.keys(this.severityLevels)) {
      stats.bySeverity[severity] = 0;
    }
    for (const type of Object.keys(this.issueTypes)) {
      stats.byType[type] = 0;
    }
    
    // Walk through fix directories
    for (const severityLevel of Object.values(this.severityLevels)) {
      const dirPath = path.join(fixesPath, severityLevel.directory);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
        stats.total += files.length;
        stats.bySeverity[this.getSeverityByDir(severityLevel.directory)] += files.length;
        
        // Analyze each file
        files.forEach(file => {
          const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
          
          // Check type
          const typeMatch = content.match(/\*\*Type\*\*:\s*(\w+)/);
          if (typeMatch) {
            const type = typeMatch[1];
            stats.byType[type] = (stats.byType[type] || 0) + 1;
          }
          
          // Check status (completed checkboxes)
          const checkboxes = content.match(/- \[[ x]\]/g) || [];
          const checked = checkboxes.filter(cb => cb.includes('[x]')).length;
          if (checked === checkboxes.length && checkboxes.length > 0) {
            stats.byStatus.closed++;
          } else {
            stats.byStatus.open++;
          }
        });
      }
    }
    
    return stats;
  }
  
  /**
   * Get severity by directory name
   */
  getSeverityByDir(dir) {
    for (const [severity, config] of Object.entries(this.severityLevels)) {
      if (config.directory === dir) {
        return severity;
      }
    }
    return 'UNKNOWN';
  }
}

// CLI interface
if (require.main === module) {
  const classifier = new ClassifierAgent();
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Check for JSON output flag
  const jsonIndex = args.indexOf('--json');
  const jsonOutput = jsonIndex > -1;
  if (jsonOutput) {
    args.splice(jsonIndex, 1); // Remove --json from args
  }
  
  switch (command) {
    case 'classify':
      // Example: classifier-agent classify "Memory leak in editor" --perf 30 --users 15
      const description = args[1];
      const perfIndex = args.indexOf('--perf');
      const usersIndex = args.indexOf('--users');
      
      const issue = {
        title: description,
        description: description,
        metrics: {
          performanceDegradation: perfIndex > -1 ? parseInt(args[perfIndex + 1]) : 0,
          usersAffected: usersIndex > -1 ? parseInt(args[usersIndex + 1]) : 0
        }
      };
      
      const classification = classifier.classify(issue);
      
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: true,
          command: 'classify',
          result: classification
        }));
      } else {
        console.log('\n📊 Issue Classification:');
        console.log(`  Severity: ${classification.icon} ${classification.severity}`);
        console.log(`  Type: ${classification.type}`);
        console.log(`  Priority: ${classification.priority}`);
        console.log(`  SLA: ${classification.sla}`);
        console.log(`  Workflow: ${classification.workflow}`);
        console.log('\n📝 Recommendations:');
        classification.recommendations.forEach(r => console.log(`  ${r}`));
      }
      break;
      
    case 'route':
      // Example: classifier-agent route "Bug in save function" docs/proposal/my-feature
      const issueDesc = args[1];
      const featurePath = args[2] || '.';
      
      const routeIssue = {
        title: issueDesc,
        description: issueDesc
      };
      
      const result = classifier.routeIssue(routeIssue, featurePath);
      
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: true,
          command: 'route',
          result: result
        }));
      } else {
        console.log('\n✅ Issue routed successfully:');
        console.log(`  Path: ${result.path}`);
        console.log(`  Severity: ${result.classification.icon} ${result.classification.severity}`);
        console.log(`  Type: ${result.classification.type}`);
      }
      break;
      
    case 'analyze':
      // Example: classifier-agent analyze docs/proposal/my-feature
      const analyzePath = args[1] || '.';
      const stats = classifier.analyzeFeature(analyzePath);
      
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: true,
          command: 'analyze',
          result: stats
        }));
      } else {
        console.log('\n📈 Feature Fix Statistics:');
        console.log(`  Total Issues: ${stats.total}`);
        console.log(`  Open: ${stats.byStatus.open} | Closed: ${stats.byStatus.closed}`);
        console.log('\n  By Severity:');
        for (const [severity, count] of Object.entries(stats.bySeverity)) {
          if (count > 0) {
            const config = classifier.severityLevels[severity];
            console.log(`    ${config.icon} ${severity}: ${count}`);
          }
        }
        console.log('\n  By Type:');
        for (const [type, count] of Object.entries(stats.byType)) {
          if (count > 0) {
            console.log(`    ${type}: ${count}`);
          }
        }
      }
      break;
      
    default:
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: false,
          error: 'Invalid command. Use: classify, route, or analyze'
        }));
      } else {
        console.log('Usage: classifier-agent <command> [options]');
        console.log('Commands:');
        console.log('  classify "description" [--perf N] [--users N] [--json]');
        console.log('  route "issue" [feature-path] [--json]');
        console.log('  analyze [feature-path] [--json]');
        console.log('\nOptions:');
        console.log('  --json    Output results in JSON format');
      }
  }
}

module.exports = ClassifierAgent;