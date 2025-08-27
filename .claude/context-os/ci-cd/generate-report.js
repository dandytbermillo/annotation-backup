#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { KnowledgeManager } = require('../core/knowledge-manager');
const { TaskManager } = require('../core/task-manager');
const { EnhancementAdvisor } = require('../core/enhancement-advisor');

/**
 * Generate comprehensive context report for CI/CD
 */
class ReportGenerator {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.reportsDir = path.join(contextRoot, 'reports');
  }

  async generate() {
    console.log('📊 Generating context report...');
    
    await fs.mkdir(this.reportsDir, { recursive: true });
    
    const report = {
      generated: new Date().toISOString(),
      environment: this.getEnvironment(),
      structure: await this.analyzeStructure(),
      knowledge: await this.analyzeKnowledge(),
      tasks: await this.analyzeTasks(),
      health: await this.analyzeHealth(),
      recommendations: await this.generateRecommendations()
    };
    
    // Save JSON report
    await fs.writeFile(
      path.join(this.reportsDir, 'context-report.json'),
      JSON.stringify(report, null, 2)
    );
    
    // Generate markdown report
    const markdown = this.generateMarkdownReport(report);
    await fs.writeFile(
      path.join(this.reportsDir, 'context-report.md'),
      markdown
    );
    
    // Generate HTML report
    const html = this.generateHtmlReport(report);
    await fs.writeFile(
      path.join(this.reportsDir, 'context-report.html'),
      html
    );
    
    console.log('✓ Report generated in:', this.reportsDir);
    
    // Output summary to console
    this.printSummary(report);
  }

  getEnvironment() {
    return {
      node: process.version,
      platform: process.platform,
      ci: process.env.CI === 'true',
      github_actions: process.env.GITHUB_ACTIONS === 'true',
      branch: process.env.GITHUB_REF_NAME || 'unknown',
      commit: process.env.GITHUB_SHA || 'unknown',
      actor: process.env.GITHUB_ACTOR || process.env.USER || 'unknown'
    };
  }

  async analyzeStructure() {
    const structure = {
      directories: {},
      files: {
        total: 0,
        byType: {},
        large: [],
        recent: []
      }
    };
    
    const analyze = async (dir, depth = 0) => {
      if (depth > 3) return; // Limit depth
      
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const relativePath = path.relative(this.contextRoot, dir);
      
      structure.directories[relativePath || '.'] = {
        fileCount: 0,
        subdirs: []
      };
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile()) {
          structure.files.total++;
          structure.directories[relativePath || '.'].fileCount++;
          
          const ext = path.extname(entry.name);
          structure.files.byType[ext] = (structure.files.byType[ext] || 0) + 1;
          
          const stat = await fs.stat(fullPath);
          
          if (stat.size > 50000) { // 50KB
            structure.files.large.push({
              path: path.relative(this.contextRoot, fullPath),
              size: stat.size
            });
          }
          
          const age = Date.now() - stat.mtime.getTime();
          if (age < 7 * 24 * 60 * 60 * 1000) { // 7 days
            structure.files.recent.push({
              path: path.relative(this.contextRoot, fullPath),
              modified: stat.mtime.toISOString()
            });
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          structure.directories[relativePath || '.'].subdirs.push(entry.name);
          await analyze(fullPath, depth + 1);
        }
      }
    };
    
    await analyze(this.contextRoot);
    
    // Sort recent files
    structure.files.recent.sort((a, b) => 
      new Date(b.modified) - new Date(a.modified)
    );
    
    return structure;
  }

  async analyzeKnowledge() {
    const km = new KnowledgeManager(this.contextRoot);
    await km.initialize();
    
    const entries = Array.from(km.index.values());
    const categories = {};
    const ageDistribution = {
      recent: 0,    // < 7 days
      active: 0,    // 7-30 days
      stable: 0,    // 30-90 days
      archive: 0    // > 90 days
    };
    
    for (const entry of entries) {
      // Count by category
      categories[entry.category] = (categories[entry.category] || 0) + 1;
      
      // Age distribution
      const age = Date.now() - new Date(entry.metadata.created).getTime();
      const days = age / (24 * 60 * 60 * 1000);
      
      if (days < 7) ageDistribution.recent++;
      else if (days < 30) ageDistribution.active++;
      else if (days < 90) ageDistribution.stable++;
      else ageDistribution.archive++;
    }
    
    // Get graph stats
    await km.buildKnowledgeGraph();
    const graphStats = {
      nodes: km.graph.size,
      totalConnections: 0,
      isolatedNodes: 0,
      avgConnections: 0
    };
    
    for (const [id, node] of km.graph) {
      graphStats.totalConnections += node.connections.size;
      if (node.connections.size === 0) {
        graphStats.isolatedNodes++;
      }
    }
    
    graphStats.avgConnections = graphStats.totalConnections / graphStats.nodes;
    
    return {
      total: entries.length,
      categories,
      ageDistribution,
      graph: graphStats,
      topPatterns: await this.getTopPatterns(km)
    };
  }

  async getTopPatterns(km) {
    const patterns = Array.from(km.index.values())
      .filter(e => e.category === 'patterns')
      .sort((a, b) => (b.metadata.usage || 0) - (a.metadata.usage || 0))
      .slice(0, 5)
      .map(e => ({
        title: km.extractTitle(e.content),
        usage: e.metadata.usage || 0,
        confidence: e.metadata.confidence || 1
      }));
    
    return patterns;
  }

  async analyzeTasks() {
    const tm = new TaskManager(this.contextRoot);
    await tm.initialize();
    
    const tasks = await tm.listTasks();
    const taskStats = {
      total: tasks.length,
      byStatus: {},
      byType: {},
      byPriority: {},
      averageAge: 0,
      oldestTask: null
    };
    
    let totalAge = 0;
    let oldestAge = 0;
    
    for (const task of tasks) {
      // By status
      taskStats.byStatus[task.status] = (taskStats.byStatus[task.status] || 0) + 1;
      
      // By type
      taskStats.byType[task.type] = (taskStats.byType[task.type] || 0) + 1;
      
      // By priority
      taskStats.byPriority[task.priority] = (taskStats.byPriority[task.priority] || 0) + 1;
      
      // Age
      const age = Date.now() - new Date(task.created).getTime();
      totalAge += age;
      
      if (age > oldestAge) {
        oldestAge = age;
        taskStats.oldestTask = {
          id: task.id,
          title: task.title,
          age: Math.floor(age / (24 * 60 * 60 * 1000)) // days
        };
      }
    }
    
    taskStats.averageAge = tasks.length > 0 
      ? Math.floor(totalAge / tasks.length / (24 * 60 * 60 * 1000))
      : 0;
    
    return taskStats;
  }

  async analyzeHealth() {
    const advisor = new EnhancementAdvisor(this.contextRoot);
    await advisor.initialize();
    
    const suggestions = await advisor.analyzeUsage();
    const metrics = JSON.parse(
      await fs.readFile(path.join(this.contextRoot, 'cache', 'metrics.json'), 'utf8')
        .catch(() => '{}')
    );
    
    const health = {
      score: 100,
      issues: [],
      metrics: {
        contextSize: metrics.avgContextSize || 0,
        fileCount: metrics.fileCount || 0,
        searchCount: metrics.searchCount || 0
      }
    };
    
    // Deduct points for issues
    for (const suggestion of suggestions) {
      if (suggestion.severity === 'high') {
        health.score -= 10;
        health.issues.push({
          severity: 'high',
          issue: suggestion.issue
        });
      } else if (suggestion.severity === 'medium') {
        health.score -= 5;
        health.issues.push({
          severity: 'medium',
          issue: suggestion.issue
        });
      }
    }
    
    // Check for other issues
    if (metrics.mergeConflicts > 0) {
      health.score -= 15;
      health.issues.push({
        severity: 'high',
        issue: `${metrics.mergeConflicts} merge conflicts`
      });
    }
    
    health.grade = this.getHealthGrade(health.score);
    
    return health;
  }

  getHealthGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  async generateRecommendations() {
    const advisor = new EnhancementAdvisor(this.contextRoot);
    await advisor.initialize();
    
    const suggestions = await advisor.getSuggestions();
    
    return suggestions.map(s => ({
      priority: s.severity,
      action: s.solution,
      benefit: s.benefit,
      command: s.command
    }));
  }

  generateMarkdownReport(report) {
    let md = `# Context OS Report

Generated: ${report.generated}

`;
    
    // Environment
    md += `## Environment

`;
    md += `- Platform: ${report.environment.platform}
`;
    md += `- Node: ${report.environment.node}
`;
    md += `- CI: ${report.environment.ci ? 'Yes' : 'No'}
`;
    if (report.environment.github_actions) {
      md += `- Branch: ${report.environment.branch}
`;
      md += `- Actor: ${report.environment.actor}
`;
    }
    
    // Health
    md += `
## Health Score: ${report.health.score}/100 (${report.health.grade})

`;
    if (report.health.issues.length > 0) {
      md += `### Issues

`;
      for (const issue of report.health.issues) {
        md += `- [${issue.severity}] ${issue.issue}
`;
      }
    }
    
    // Structure
    md += `
## Structure

`;
    md += `- Total Files: ${report.structure.files.total}
`;
    md += `- Directories: ${Object.keys(report.structure.directories).length}
`;
    md += `- Recent Changes: ${report.structure.files.recent.length} files in last 7 days
`;
    
    // Knowledge
    md += `
## Knowledge Base

`;
    md += `- Total Entries: ${report.knowledge.total}
`;
    md += `- Graph Nodes: ${report.knowledge.graph.nodes}
`;
    md += `- Avg Connections: ${report.knowledge.graph.avgConnections.toFixed(1)}
`;
    
    if (report.knowledge.topPatterns.length > 0) {
      md += `
### Top Patterns

`;
      for (const pattern of report.knowledge.topPatterns) {
        md += `1. ${pattern.title} (used ${pattern.usage} times)
`;
      }
    }
    
    // Tasks
    md += `
## Tasks

`;
    md += `- Total: ${report.tasks.total}
`;
    md += `- Average Age: ${report.tasks.averageAge} days
`;
    
    md += `
### By Status
`;
    for (const [status, count] of Object.entries(report.tasks.byStatus)) {
      md += `- ${status}: ${count}
`;
    }
    
    // Recommendations
    if (report.recommendations.length > 0) {
      md += `
## Recommendations

`;
      for (const rec of report.recommendations) {
        md += `### ${rec.action}
`;
        md += `- Priority: ${rec.priority}
`;
        md += `- Benefit: ${rec.benefit}
`;
        md += `- Command: \`${rec.command}\`

`;
      }
    }
    
    return md;
  }

  generateHtmlReport(report) {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Context OS Report</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 40px; }
    h1, h2, h3 { color: #333; }
    .metric { display: inline-block; margin: 10px 20px 10px 0; }
    .metric-value { font-size: 2em; font-weight: bold; }
    .metric-label { color: #666; }
    .health-score { 
      font-size: 3em; 
      color: ${report.health.score >= 80 ? '#22c55e' : report.health.score >= 60 ? '#f59e0b' : '#ef4444'};
    }
    .issue { padding: 5px 10px; margin: 5px 0; background: #fee; border-left: 3px solid #f88; }
    .recommendation { padding: 10px; margin: 10px 0; background: #f0f9ff; border-left: 3px solid #3b82f6; }
    pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>Context OS Report</h1>
  <p>Generated: ${new Date(report.generated).toLocaleString()}</p>
  
  <h2>Health Score</h2>
  <div class="health-score">${report.health.score}/100 (${report.health.grade})</div>
  
  <h2>Key Metrics</h2>
  <div>
    <div class="metric">
      <div class="metric-value">${report.structure.files.total}</div>
      <div class="metric-label">Total Files</div>
    </div>
    <div class="metric">
      <div class="metric-value">${report.knowledge.total}</div>
      <div class="metric-label">Knowledge Entries</div>
    </div>
    <div class="metric">
      <div class="metric-value">${report.tasks.total}</div>
      <div class="metric-label">Active Tasks</div>
    </div>
  </div>
  
  ${report.health.issues.length > 0 ? `
  <h2>Issues</h2>
  ${report.health.issues.map(issue => 
    `<div class="issue">[${issue.severity}] ${issue.issue}</div>`
  ).join('')}
  ` : ''}
  
  ${report.recommendations.length > 0 ? `
  <h2>Recommendations</h2>
  ${report.recommendations.map(rec => `
    <div class="recommendation">
      <h3>${rec.action}</h3>
      <p>Priority: ${rec.priority}</p>
      <p>Benefit: ${rec.benefit}</p>
      <pre>${rec.command}</pre>
    </div>
  `).join('')}
  ` : ''}
</body>
</html>`;
  }

  printSummary(report) {
    console.log('\n📋 Report Summary');
    console.log('=================');
    console.log(`Health Score: ${report.health.score}/100 (${report.health.grade})`);
    console.log(`Total Files: ${report.structure.files.total}`);
    console.log(`Knowledge Entries: ${report.knowledge.total}`);
    console.log(`Active Tasks: ${report.tasks.total}`);
    
    if (report.health.issues.length > 0) {
      console.log('\nIssues:');
      for (const issue of report.health.issues.slice(0, 3)) {
        console.log(`  - [${issue.severity}] ${issue.issue}`);
      }
    }
    
    if (report.recommendations.length > 0) {
      console.log('\nTop Recommendations:');
      for (const rec of report.recommendations.slice(0, 3)) {
        console.log(`  - ${rec.action}`);
      }
    }
  }
}

// Run report generation
if (require.main === module) {
  const generator = new ReportGenerator(path.join(__dirname, '..'));
  generator.generate().catch(console.error);
}