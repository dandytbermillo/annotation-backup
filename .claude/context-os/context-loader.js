#!/usr/bin/env node

/**
 * Context Loader for Claude
 * Generates optimized context files that can be loaded directly into Claude
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const CONTEXT_OS_ROOT = __dirname;
const PROJECT_ROOT = path.resolve(CONTEXT_OS_ROOT, '../..');

class ContextLoader {
  constructor() {
    this.maxTokens = 50000; // Approximate token limit
    this.priorityFiles = [];
    this.contextSections = [];
  }

  /**
   * Load context for a specific task or area
   */
  loadForTask(task) {
    console.log(`Loading context for: ${task}`);
    
    // Load project overview
    this.addSection('Project Overview', this.loadProjectContext());
    
    // Load current work
    this.addSection('Current Work', this.loadCurrentWork());
    
    // Load relevant patterns and knowledge
    const relevantKnowledge = this.findRelevantKnowledge(task);
    if (relevantKnowledge.length > 0) {
      this.addSection('Relevant Knowledge', relevantKnowledge.join('\n\n'));
    }
    
    // Load recent errors and solutions
    const recentErrors = this.loadRecentErrors();
    if (recentErrors) {
      this.addSection('Recent Issues & Solutions', recentErrors);
    }
    
    // Load task-specific context
    const taskContext = this.loadTaskSpecificContext(task);
    if (taskContext) {
      this.addSection(`${task} Context`, taskContext);
    }
    
    return this.generateOutput();
  }

  /**
   * Load full context dump
   */
  loadFull() {
    console.log('Loading full context...');
    
    // Core project info
    this.addSection('Project Overview', this.loadProjectContext());
    
    // Architecture and patterns
    this.addSection('Architecture & Patterns', this.loadArchitectureContext());
    
    // Current state
    this.addSection('Current Work', this.loadCurrentWork());
    
    // Knowledge base
    this.addSection('Knowledge Base', this.loadKnowledgeBase());
    
    // Recent activity
    this.addSection('Recent Activity', this.loadRecentActivity());
    
    return this.generateOutput();
  }

  /**
   * Load minimal context for quick tasks
   */
  loadMinimal() {
    console.log('Loading minimal context...');
    
    this.addSection('Project Summary', this.loadProjectSummary());
    this.addSection('Current Focus', this.loadCurrentFocus());
    
    return this.generateOutput();
  }

  // Helper methods

  loadProjectContext() {
    const files = [
      path.join(CONTEXT_OS_ROOT, 'project.md'),
      path.join(PROJECT_ROOT, 'README.md'),
      path.join(PROJECT_ROOT, 'CLAUDE.md')
    ];
    
    return this.loadFiles(files);
  }

  loadProjectSummary() {
    const projectFile = path.join(CONTEXT_OS_ROOT, 'project.md');
    if (!fs.existsSync(projectFile)) return '';
    
    const content = fs.readFileSync(projectFile, 'utf8');
    const lines = content.split('\n');
    
    // Extract first paragraph after title
    const startIdx = lines.findIndex(l => l.trim() && !l.startsWith('#'));
    const endIdx = lines.findIndex((l, i) => i > startIdx && l.trim() === '');
    
    return lines.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 5).join('\n');
  }

  loadCurrentWork() {
    const currentDir = path.join(CONTEXT_OS_ROOT, 'current');
    const files = fs.readdirSync(currentDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(currentDir, f));
    
    return this.loadFiles(files);
  }

  loadCurrentFocus() {
    const activeFile = path.join(CONTEXT_OS_ROOT, 'current/active.md');
    if (!fs.existsSync(activeFile)) return 'No active work context.';
    
    return fs.readFileSync(activeFile, 'utf8');
  }

  loadArchitectureContext() {
    const patterns = this.loadPatterns();
    const decisions = this.loadDecisions();
    
    return `## Patterns\n\n${patterns}\n\n## Decisions\n\n${decisions}`;
  }

  loadPatterns() {
    const patternsDir = path.join(CONTEXT_OS_ROOT, 'knowledge/patterns');
    if (!fs.existsSync(patternsDir)) return 'No patterns documented.';
    
    const files = fs.readdirSync(patternsDir)
      .filter(f => f.endsWith('.md'))
      .slice(0, 5) // Limit to 5 most recent
      .map(f => path.join(patternsDir, f));
    
    return this.loadFiles(files);
  }

  loadDecisions() {
    const decisionsDir = path.join(CONTEXT_OS_ROOT, 'knowledge/decisions');
    const decisionFiles = [
      path.join(decisionsDir, 'architecture-choices.md'),
      path.join(decisionsDir, 'log.md'),
      path.join(decisionsDir, 'recent.md')
    ].filter(fs.existsSync);
    
    return this.loadFiles(decisionFiles);
  }

  loadKnowledgeBase() {
    const knowledgeIndex = path.join(CONTEXT_OS_ROOT, 'knowledge/index.md');
    const learned = path.join(CONTEXT_OS_ROOT, 'knowledge/learned.md');
    
    return this.loadFiles([knowledgeIndex, learned].filter(fs.existsSync));
  }

  loadRecentErrors() {
    const errorsDir = path.join(CONTEXT_OS_ROOT, 'knowledge/errors');
    if (!fs.existsSync(errorsDir)) return '';
    
    const errorFiles = fs.readdirSync(errorsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ name: f, path: path.join(errorsDir, f) }))
      .map(f => ({ ...f, stat: fs.statSync(f.path) }))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 3)
      .map(f => f.path);
    
    return this.loadFiles(errorFiles);
  }

  loadRecentActivity() {
    const commitLog = path.join(CONTEXT_OS_ROOT, 'knowledge/commit-log.json');
    if (!fs.existsSync(commitLog)) return 'No recent commits tracked.';
    
    const commits = JSON.parse(fs.readFileSync(commitLog, 'utf8'));
    const recent = commits.slice(0, 5);
    
    return recent.map(c => 
      `- ${c.hash.substring(0, 7)}: ${c.message} (${c.files.length} files)`
    ).join('\n');
  }

  findRelevantKnowledge(task) {
    const keywords = task.toLowerCase().split(/\s+/);
    const knowledgeDir = path.join(CONTEXT_OS_ROOT, 'knowledge');
    const relevant = [];
    
    // Search through knowledge files
    this.walkDir(knowledgeDir, (file) => {
      if (!file.endsWith('.md')) return;
      
      const content = fs.readFileSync(file, 'utf8').toLowerCase();
      const filename = path.basename(file).toLowerCase();
      
      // Check relevance
      let score = 0;
      keywords.forEach(keyword => {
        if (filename.includes(keyword)) score += 2;
        if (content.includes(keyword)) score += 1;
      });
      
      if (score > 0) {
        relevant.push({ file, score });
      }
    });
    
    // Sort by relevance and take top 5
    return relevant
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(r => this.loadFile(r.file));
  }

  loadTaskSpecificContext(task) {
    const taskLower = task.toLowerCase();
    
    // Map common tasks to specific context
    if (taskLower.includes('postgres') || taskLower.includes('database')) {
      return this.loadDatabaseContext();
    }
    
    if (taskLower.includes('yjs') || taskLower.includes('collaboration')) {
      return this.loadCollaborationContext();
    }
    
    if (taskLower.includes('test')) {
      return this.loadTestingContext();
    }
    
    if (taskLower.includes('fix') || taskLower.includes('bug')) {
      return this.loadDebuggingContext();
    }
    
    return '';
  }

  loadDatabaseContext() {
    const files = [
      path.join(PROJECT_ROOT, 'migrations'),
      path.join(PROJECT_ROOT, 'lib/db'),
      path.join(PROJECT_ROOT, 'lib/adapters')
    ].filter(fs.existsSync);
    
    const schemas = [];
    files.forEach(dir => {
      if (fs.statSync(dir).isDirectory()) {
        fs.readdirSync(dir).forEach(file => {
          if (file.endsWith('.sql') || file.includes('schema')) {
            schemas.push(path.join(dir, file));
          }
        });
      }
    });
    
    return this.loadFiles(schemas.slice(0, 5));
  }

  loadCollaborationContext() {
    const yjsPatterns = path.join(CONTEXT_OS_ROOT, 'knowledge/patterns/yjs-integration.md');
    const yjsDocs = path.join(PROJECT_ROOT, 'docs/yjs-annotation-architecture.md');
    
    return this.loadFiles([yjsPatterns, yjsDocs].filter(fs.existsSync));
  }

  loadTestingContext() {
    const testDirs = [
      path.join(PROJECT_ROOT, '__tests__'),
      path.join(PROJECT_ROOT, 'test'),
      path.join(PROJECT_ROOT, 'tests')
    ].filter(fs.existsSync);
    
    if (testDirs.length === 0) return 'No test directories found.';
    
    const testFiles = [];
    testDirs.forEach(dir => {
      fs.readdirSync(dir).forEach(file => {
        if (file.includes('.test.') || file.includes('.spec.')) {
          testFiles.push(path.join(dir, file));
        }
      });
    });
    
    return `Found ${testFiles.length} test files in: ${testDirs.map(d => path.relative(PROJECT_ROOT, d)).join(', ')}`;
  }

  loadDebuggingContext() {
    const recentErrors = this.loadRecentErrors();
    const commonIssues = path.join(CONTEXT_OS_ROOT, 'knowledge/errors/common-issues.md');
    
    let context = recentErrors || 'No recent errors tracked.';
    
    if (fs.existsSync(commonIssues)) {
      context += '\n\n' + fs.readFileSync(commonIssues, 'utf8');
    }
    
    return context;
  }

  // Utility methods

  loadFiles(files) {
    return files
      .filter(f => fs.existsSync(f))
      .map(f => this.loadFile(f))
      .join('\n\n');
  }

  loadFile(file) {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(PROJECT_ROOT, file);
    
    // Parse frontmatter if present
    const parsed = matter(content);
    const title = parsed.data.title || path.basename(file, path.extname(file));
    
    return `### ${title}\n_File: ${relativePath}_\n\n${parsed.content}`;
  }

  walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        if (!file.startsWith('.') && file !== 'node_modules') {
          this.walkDir(fullPath, callback);
        }
      } else {
        callback(fullPath);
      }
    });
  }

  addSection(title, content) {
    if (!content || content.trim() === '') return;
    
    this.contextSections.push({
      title,
      content: content.trim()
    });
  }

  generateOutput() {
    const output = [
      '# Context OS - Generated Context',
      `Generated: ${new Date().toISOString()}`,
      `Sections: ${this.contextSections.length}`,
      '',
      '---',
      ''
    ];
    
    this.contextSections.forEach(section => {
      output.push(`## ${section.title}`);
      output.push('');
      output.push(section.content);
      output.push('');
      output.push('---');
      output.push('');
    });
    
    return output.join('\n');
  }
}

// CLI interface
if (require.main === module) {
  const loader = new ContextLoader();
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  let output;
  
  switch (command) {
    case 'task':
      output = loader.loadForTask(args.join(' ') || 'general');
      break;
    case 'full':
      output = loader.loadFull();
      break;
    case 'minimal':
      output = loader.loadMinimal();
      break;
    default:
      console.log('Usage: context-loader <task|full|minimal> [args]');
      process.exit(1);
  }
  
  // Output to file or stdout
  const outputFile = process.env.CONTEXT_OUTPUT;
  if (outputFile) {
    fs.writeFileSync(outputFile, output);
    console.log(`Context written to: ${outputFile}`);
  } else {
    console.log(output);
  }
}

module.exports = ContextLoader;