#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EnhancementAdvisor } = require('./enhancement-advisor');

/**
 * Task Manager - Automatic task management with context switching
 */
class TaskManager {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.tasksRoot = path.join(contextRoot, 'tasks');
    this.currentDir = path.join(contextRoot, 'current');
    this.activeTaskPath = path.join(this.tasksRoot, '.active-task.json');
    this.taskHistoryPath = path.join(this.tasksRoot, '.task-history.json');
    this.contextCacheDir = path.join(contextRoot, 'cache', 'task-contexts');
    this.advisor = new EnhancementAdvisor(contextRoot);
  }

  async initialize() {
    await fs.mkdir(this.tasksRoot, { recursive: true });
    await fs.mkdir(this.currentDir, { recursive: true });
    await fs.mkdir(this.contextCacheDir, { recursive: true });
    await this.advisor.initialize();
    
    // Initialize task history if not exists
    try {
      await fs.access(this.taskHistoryPath);
    } catch {
      await fs.writeFile(this.taskHistoryPath, JSON.stringify([], null, 2));
    }
  }

  /**
   * Create a new task
   */
  async createTask(title, options = {}) {
    const taskId = this.generateTaskId(title);
    const timestamp = new Date().toISOString();
    
    const task = {
      id: taskId,
      title,
      description: options.description || '',
      type: options.type || 'feature',
      priority: options.priority || 'medium',
      status: 'pending',
      created: timestamp,
      updated: timestamp,
      context: {
        files: [],
        patterns: [],
        errors: []
      },
      checklist: this.generateChecklist(options.type || 'feature'),
      metadata: {
        branch: await this.getCurrentBranch(),
        parent: options.parent || null,
        tags: options.tags || [],
        estimate: options.estimate || null
      }
    };
    
    // Save task
    const taskPath = path.join(this.tasksRoot, `${taskId}.json`);
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
    
    // Create task file in current/
    const taskFile = path.join(this.currentDir, `${taskId}.md`);
    const taskContent = this.generateTaskFile(task);
    await fs.writeFile(taskFile, taskContent);
    
    // Auto-switch to new task
    if (options.autoSwitch !== false) {
      await this.switchToTask(taskId);
    }
    
    // Update task history
    await this.updateTaskHistory('created', task);
    
    console.log(`✓ Created task: ${taskId}`);
    console.log(`  File: ${taskFile}`);
    
    return task;
  }

  /**
   * Switch context to a different task
   */
  async switchToTask(taskId) {
    const startTime = Date.now();
    
    // Get current active task
    const currentTask = await this.getActiveTask();
    
    if (currentTask && currentTask.id === taskId) {
      console.log('ℹ️  Already on this task');
      return;
    }
    
    // Save current context if exists
    if (currentTask) {
      await this.saveTaskContext(currentTask.id);
      await this.unloadCurrentContext();
    }
    
    // Load new task
    const task = await this.loadTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    // Load task context
    await this.loadTaskContext(taskId);
    
    // Update active task
    await fs.writeFile(this.activeTaskPath, JSON.stringify({
      taskId,
      switchedAt: new Date().toISOString()
    }, null, 2));
    
    // Track switch time
    const duration = Date.now() - startTime;
    await this.advisor.trackTaskSwitch(
      currentTask ? currentTask.id : 'none',
      taskId,
      duration
    );
    
    // Update task history
    await this.updateTaskHistory('switched', task);
    
    console.log(`✓ Switched to task: ${task.title}`);
    console.log(`  Type: ${task.type}`);
    console.log(`  Status: ${task.status}`);
    console.log(`  Switch time: ${duration}ms`);
  }

  /**
   * Save current task context
   */
  async saveTaskContext(taskId) {
    const context = {
      savedAt: new Date().toISOString(),
      openFiles: await this.getOpenFiles(),
      cursorPositions: await this.getCursorPositions(),
      terminalHistory: await this.getTerminalHistory(),
      todoList: await this.getTodoList()
    };
    
    const contextPath = path.join(this.contextCacheDir, `${taskId}.json`);
    await fs.writeFile(contextPath, JSON.stringify(context, null, 2));
  }

  /**
   * Load task context
   */
  async loadTaskContext(taskId) {
    const contextPath = path.join(this.contextCacheDir, `${taskId}.json`);
    
    try {
      const context = JSON.parse(await fs.readFile(contextPath, 'utf8'));
      
      // Restore open files
      if (context.openFiles && context.openFiles.length > 0) {
        console.log(`  Restoring ${context.openFiles.length} open files...`);
        // In real implementation, would integrate with editor
      }
      
      // Restore todo list
      if (context.todoList) {
        console.log(`  Restoring ${context.todoList.length} todo items...`);
        // Would call TodoWrite here
      }
      
    } catch (error) {
      // No cached context, load fresh
      console.log('  Loading fresh context...');
      
      const task = await this.loadTask(taskId);
      const taskFile = path.join(this.currentDir, `${taskId}.md`);
      
      // Load task-specific files
      const filesToLoad = [
        'project.md',
        taskFile
      ];
      
      // Add task-specific patterns
      if (task.type === 'bug') {
        filesToLoad.push('knowledge/errors/*.md');
      } else if (task.type === 'feature') {
        filesToLoad.push(`knowledge/patterns/${task.metadata.tags[0] || '*'}.md`);
      }
      
      console.log(`  Loading: ${filesToLoad.join(', ')}`);
    }
  }

  /**
   * Mark task as complete
   */
  async completeTask(taskId, options = {}) {
    const task = await this.loadTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    task.status = 'completed';
    task.updated = new Date().toISOString();
    task.completedAt = task.updated;
    
    // Save updated task
    const taskPath = path.join(this.tasksRoot, `${taskId}.json`);
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
    
    // Archive task file
    const taskFile = path.join(this.currentDir, `${taskId}.md`);
    const archiveDir = path.join(this.currentDir, '.archived');
    await fs.mkdir(archiveDir, { recursive: true });
    
    const archivePath = path.join(archiveDir, `${taskId}.md`);
    await fs.rename(taskFile, archivePath);
    
    // Extract and merge learnings
    if (options.mergeLearnings !== false) {
      await this.extractTaskLearnings(task);
    }
    
    // Update task history
    await this.updateTaskHistory('completed', task);
    
    // Clear active task if it was this one
    const activeTask = await this.getActiveTask();
    if (activeTask && activeTask.id === taskId) {
      await fs.unlink(this.activeTaskPath).catch(() => {});
    }
    
    console.log(`✓ Completed task: ${task.title}`);
    console.log(`  Archived to: ${archivePath}`);
  }

  /**
   * List tasks with filtering
   */
  async listTasks(filter = {}) {
    const files = await fs.readdir(this.tasksRoot);
    const tasks = [];
    
    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('.')) {
        const taskPath = path.join(this.tasksRoot, file);
        const task = JSON.parse(await fs.readFile(taskPath, 'utf8'));
        
        // Apply filters
        if (filter.status && task.status !== filter.status) continue;
        if (filter.type && task.type !== filter.type) continue;
        if (filter.priority && task.priority !== filter.priority) continue;
        
        tasks.push(task);
      }
    }
    
    // Sort by updated date
    tasks.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    
    return tasks;
  }

  /**
   * Generate task ID
   */
  generateTaskId(title) {
    const slug = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30);
    
    const hash = crypto.createHash('md5')
      .update(title + Date.now())
      .digest('hex')
      .substring(0, 6);
    
    return `${slug}-${hash}`;
  }

  /**
   * Generate task checklist based on type
   */
  generateChecklist(type) {
    const checklists = {
      feature: [
        'Understand requirements',
        'Design implementation approach',
        'Write tests',
        'Implement feature',
        'Update documentation',
        'Test edge cases',
        'Code review'
      ],
      bug: [
        'Reproduce the issue',
        'Identify root cause',
        'Write failing test',
        'Implement fix',
        'Verify fix works',
        'Check for regressions',
        'Update documentation'
      ],
      refactor: [
        'Identify refactoring scope',
        'Write tests for current behavior',
        'Plan refactoring steps',
        'Implement refactoring',
        'Ensure tests still pass',
        'Update documentation',
        'Performance comparison'
      ],
      investigation: [
        'Define investigation goals',
        'Gather relevant data',
        'Analyze findings',
        'Document discoveries',
        'Propose next steps'
      ]
    };
    
    return checklists[type] || checklists.feature;
  }

  /**
   * Generate task file content
   */
  generateTaskFile(task) {
    return `# ${task.title}

Type: ${task.type}
Priority: ${task.priority}
Created: ${task.created}
${task.metadata.branch ? `Branch: ${task.metadata.branch}` : ''}
${task.metadata.tags.length > 0 ? `Tags: ${task.metadata.tags.join(', ')}` : ''}

## Description

${task.description || 'TODO: Add description'}

## Checklist

${task.checklist.map(item => `- [ ] ${item}`).join('\n')}

## Notes

<!-- Add implementation notes here -->

## Learnings

<!-- Document what you learned while working on this task -->

## References

<!-- Add links to relevant documentation, PRs, issues, etc. -->
`;
  }

  /**
   * Get current git branch
   */
  async getCurrentBranch() {
    try {
      const { execSync } = require('child_process');
      return execSync('git branch --show-current').toString().trim();
    } catch {
      return 'main';
    }
  }

  /**
   * Get active task
   */
  async getActiveTask() {
    try {
      const active = JSON.parse(await fs.readFile(this.activeTaskPath, 'utf8'));
      return await this.loadTask(active.taskId);
    } catch {
      return null;
    }
  }

  /**
   * Load task by ID
   */
  async loadTask(taskId) {
    try {
      const taskPath = path.join(this.tasksRoot, `${taskId}.json`);
      return JSON.parse(await fs.readFile(taskPath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Update task history
   */
  async updateTaskHistory(action, task) {
    const history = JSON.parse(await fs.readFile(this.taskHistoryPath, 'utf8'));
    
    history.push({
      timestamp: new Date().toISOString(),
      action,
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type
    });
    
    // Keep last 100 entries
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    
    await fs.writeFile(this.taskHistoryPath, JSON.stringify(history, null, 2));
  }

  /**
   * Extract learnings from completed task
   */
  async extractTaskLearnings(task) {
    const taskFile = path.join(this.currentDir, '.archived', `${task.id}.md`);
    
    try {
      const content = await fs.readFile(taskFile, 'utf8');
      
      // Extract learnings section
      const learningsMatch = content.match(/## Learnings\n\n([\s\S]*?)(?=\n##|$)/);
      if (learningsMatch && learningsMatch[1].trim()) {
        const learnings = learningsMatch[1].trim();
        
        // Add to knowledge base
        const { KnowledgeManager } = require('./knowledge-manager');
        const km = new KnowledgeManager(this.contextRoot);
        await km.initialize();
        
        await km.addLearning(learnings, {
          source: `task:${task.id}`,
          type: task.type,
          tags: task.metadata.tags
        });
        
        console.log('  ✓ Extracted learnings to knowledge base');
      }
    } catch (error) {
      console.error('  Failed to extract learnings:', error.message);
    }
  }

  /**
   * Get open files (stub - would integrate with editor)
   */
  async getOpenFiles() {
    // In real implementation, would get from editor API
    return [];
  }

  /**
   * Get cursor positions (stub)
   */
  async getCursorPositions() {
    // In real implementation, would get from editor API
    return {};
  }

  /**
   * Get terminal history (stub)
   */
  async getTerminalHistory() {
    // In real implementation, would get from terminal
    return [];
  }

  /**
   * Get todo list (stub)
   */
  async getTodoList() {
    // In real implementation, would call TodoRead
    return [];
  }

  /**
   * Unload current context
   */
  async unloadCurrentContext() {
    // In real implementation, would close files, clear state
    console.log('  Unloading current context...');
  }

  /**
   * Show task status
   */
  async showStatus() {
    const activeTask = await this.getActiveTask();
    const pendingTasks = await this.listTasks({ status: 'pending' });
    const inProgressTasks = await this.listTasks({ status: 'in_progress' });
    
    console.log('📝 Task Status');
    console.log('=============');
    
    if (activeTask) {
      console.log(`\nActive Task: ${activeTask.title}`);
      console.log(`  Type: ${activeTask.type}`);
      console.log(`  Status: ${activeTask.status}`);
      console.log(`  Created: ${new Date(activeTask.created).toLocaleDateString()}`);
    } else {
      console.log('\nNo active task');
    }
    
    console.log(`\nIn Progress: ${inProgressTasks.length}`);
    for (const task of inProgressTasks.slice(0, 3)) {
      console.log(`  - ${task.title} (${task.type})`);
    }
    
    console.log(`\nPending: ${pendingTasks.length}`);
    for (const task of pendingTasks.slice(0, 3)) {
      console.log(`  - ${task.title} (${task.priority})`);
    }
    
    if (pendingTasks.length > 3) {
      console.log(`  ... and ${pendingTasks.length - 3} more`);
    }
  }
}

module.exports = { TaskManager };

// CLI interface
if (require.main === module) {
  const manager = new TaskManager(path.join(__dirname, '..'));
  
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  (async () => {
    await manager.initialize();
    
    switch (command) {
      case 'new':
        const title = args.join(' ');
        if (!title) {
          console.error('Usage: task new <title>');
          process.exit(1);
        }
        await manager.createTask(title);
        break;
        
      case 'switch':
        if (!args[0]) {
          console.error('Usage: task switch <task-id>');
          process.exit(1);
        }
        await manager.switchToTask(args[0]);
        break;
        
      case 'complete':
        const activeTask = await manager.getActiveTask();
        if (!activeTask) {
          console.error('No active task');
          process.exit(1);
        }
        await manager.completeTask(activeTask.id);
        break;
        
      case 'list':
        const tasks = await manager.listTasks();
        for (const task of tasks) {
          console.log(`${task.id} - ${task.title} [${task.status}]`);
        }
        break;
        
      case 'status':
        await manager.showStatus();
        break;
        
      default:
        console.log('Usage: task [new|switch|complete|list|status]');
    }
  })();
}