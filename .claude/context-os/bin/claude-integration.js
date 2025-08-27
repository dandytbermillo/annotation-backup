#!/usr/bin/env node

/**
 * Claude Integration - Provides Claude-compatible commands
 * This script can be called from Claude to execute context commands
 */

const path = require('path');
const { KnowledgeManager } = require('../core/knowledge-manager');
const { TaskManager } = require('../core/task-manager');
const { TokenOptimizer } = require('../core/token-optimizer');
const { EnhancementAdvisor } = require('../core/enhancement-advisor');
const { TeamSyncManager } = require('../team/team-sync');

const contextRoot = path.join(__dirname, '..');

// Command registry that mimics Claude's command structure
const claudeCommands = {
  '/context': contextCommand,
  '/task': taskCommand,
  '/learn': learnCommand,
  '/search': searchCommand,
  '/todo': todoCommand,
  '/file': fileCommand
};

/**
 * Main context command handler
 */
async function contextCommand(action, ...args) {
  switch (action) {
    case 'load':
      const optimizer = new TokenOptimizer(contextRoot);
      await optimizer.initialize();
      const intent = args.join(' ') || 'default';
      const context = await optimizer.loadOptimizedContext(intent);
      
      // Format for Claude
      const output = [
        `Loaded ${context.files.length} files (${context.totalTokens} tokens)`,
        `Utilization: ${Math.round(context.utilization * 100)}%`,
        '',
        'Files:'
      ];
      
      for (const file of context.files) {
        output.push(`- ${file.path} (${file.tokens} tokens)`);
      }
      
      return output.join('\n');
      
    case 'learn':
      return await learnCommand(args.join(' '));
      
    case 'search':
      return await searchCommand(args.join(' '));
      
    case 'status':
      const manager = new TaskManager(contextRoot);
      await manager.initialize();
      
      const activeTask = await manager.getActiveTask();
      const pendingCount = (await manager.listTasks({ status: 'pending' })).length;
      
      return [
        'Context Status:',
        activeTask ? `Active Task: ${activeTask.title}` : 'No active task',
        `Pending Tasks: ${pendingCount}`,
        '',
        'Use /task list for details'
      ].join('\n');
      
    default:
      return 'Usage: /context [load|learn|search|status]';
  }
}

/**
 * Task command handler
 */
async function taskCommand(action, ...args) {
  const manager = new TaskManager(contextRoot);
  await manager.initialize();
  
  switch (action) {
    case 'new':
      const title = args.join(' ');
      if (!title) {
        return 'Usage: /task new <title>';
      }
      
      const task = await manager.createTask(title);
      
      // Generate checklist for Claude's TodoWrite
      const checklist = task.checklist.map((item, i) => ({
        id: `${task.id}-${i}`,
        content: item,
        status: 'pending',
        priority: task.priority
      }));
      
      return {
        message: `Created task: ${task.id}`,
        checklist
      };
      
    case 'switch':
      const taskId = args[0];
      if (!taskId) {
        return 'Usage: /task switch <task-id>';
      }
      
      await manager.switchToTask(taskId);
      const task = await manager.loadTask(taskId);
      
      return [
        `Switched to: ${task.title}`,
        `Type: ${task.type}`,
        `Status: ${task.status}`,
        '',
        `File: current/${taskId}.md`
      ].join('\n');
      
    case 'complete':
      const activeTask = await manager.getActiveTask();
      if (!activeTask) {
        return 'No active task to complete';
      }
      
      await manager.completeTask(activeTask.id);
      return `Completed: ${activeTask.title}`;
      
    case 'list':
      const tasks = await manager.listTasks();
      const output = ['Tasks:'];
      
      for (const task of tasks.slice(0, 10)) {
        output.push(`- ${task.id}: ${task.title} [${task.status}]`);
      }
      
      if (tasks.length > 10) {
        output.push(`... and ${tasks.length - 10} more`);
      }
      
      return output.join('\n');
      
    case 'merge':
      // Extract and merge task learnings
      const taskToMerge = args[0] || (await manager.getActiveTask())?.id;
      if (!taskToMerge) {
        return 'No task specified';
      }
      
      const taskData = await manager.loadTask(taskToMerge);
      if (taskData) {
        await manager.extractTaskLearnings(taskData);
        return `Merged learnings from: ${taskData.title}`;
      }
      return 'Task not found';
      
    default:
      return 'Usage: /task [new|switch|complete|list|merge]';
  }
}

/**
 * Learn command - adds to knowledge base
 */
async function learnCommand(content) {
  if (!content) {
    return 'Usage: /learn <knowledge>';
  }
  
  const km = new KnowledgeManager(contextRoot);
  await km.initialize();
  
  const result = await km.addLearning(content);
  
  return [
    `Knowledge ${result.action}!`,
    `Category: ${result.category}`,
    `ID: ${result.id}`
  ].join('\n');
}

/**
 * Search command - searches knowledge base
 */
async function searchCommand(query) {
  if (!query) {
    return 'Usage: /search <query>';
  }
  
  const km = new KnowledgeManager(contextRoot);
  await km.initialize();
  
  const results = await km.searchKnowledge(query, { limit: 5 });
  
  if (results.length === 0) {
    return 'No results found';
  }
  
  const output = [`Found ${results.length} results:`, ''];
  
  for (const result of results) {
    const title = km.extractTitle(result.content);
    output.push(`[${result.category}] ${title}`);
    output.push(`Score: ${result.score.toFixed(2)}`);
    output.push(result.content.substring(0, 150) + '...');
    output.push('');
  }
  
  return output.join('\n');
}

/**
 * Todo command - formats for Claude's TodoWrite
 */
async function todoCommand(action, ...args) {
  const manager = new TaskManager(contextRoot);
  await manager.initialize();
  
  const activeTask = await manager.getActiveTask();
  if (!activeTask) {
    return 'No active task. Use /task new to create one.';
  }
  
  // Return formatted todo list for Claude
  return {
    taskId: activeTask.id,
    taskTitle: activeTask.title,
    todos: activeTask.checklist.map((item, i) => ({
      id: `${activeTask.id}-${i}`,
      content: item,
      status: 'pending',
      priority: activeTask.priority
    }))
  };
}

/**
 * File command - helps with file operations
 */
async function fileCommand(action, ...args) {
  switch (action) {
    case 'suggest':
      // Suggest files to read based on current context
      const optimizer = new TokenOptimizer(contextRoot);
      await optimizer.initialize();
      
      const intent = args.join(' ') || 'default';
      const context = await optimizer.loadOptimizedContext(intent);
      
      return [
        'Suggested files to read:',
        ...context.files.slice(0, 5).map(f => `- ${f.path}`)
      ].join('\n');
      
    case 'find':
      // Find files matching pattern
      const pattern = args[0];
      if (!pattern) {
        return 'Usage: /file find <pattern>';
      }
      
      // Simple file search (in production, use proper glob)
      const { execSync } = require('child_process');
      try {
        const files = execSync(`find ${contextRoot} -name "*${pattern}*" -type f | head -10`)
          .toString()
          .split('\n')
          .filter(f => f && !f.includes('node_modules') && !f.includes('.git'))
          .map(f => path.relative(contextRoot, f));
          
        return files.length > 0 ? files.join('\n') : 'No files found';
      } catch {
        return 'Search failed';
      }
      
    default:
      return 'Usage: /file [suggest|find]';
  }
}

/**
 * Execute Claude command
 */
async function executeClaudeCommand(commandLine) {
  const parts = commandLine.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  
  if (claudeCommands[command]) {
    try {
      const result = await claudeCommands[command](...args);
      
      // Format result for Claude
      if (typeof result === 'object') {
        return JSON.stringify(result, null, 2);
      }
      return result;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }
  
  return `Unknown command: ${command}\nAvailable: ${Object.keys(claudeCommands).join(', ')}`;
}

// Export for use in other scripts
module.exports = {
  executeClaudeCommand,
  contextCommand,
  taskCommand,
  learnCommand,
  searchCommand
};

// CLI interface
if (require.main === module) {
  const commandLine = process.argv.slice(2).join(' ');
  
  if (!commandLine) {
    console.log('Claude Integration - Available commands:');
    console.log('  /context [load|learn|search|status]');
    console.log('  /task [new|switch|complete|list|merge]');
    console.log('  /learn <knowledge>');
    console.log('  /search <query>');
    console.log('  /todo');
    console.log('  /file [suggest|find]');
    process.exit(0);
  }
  
  executeClaudeCommand(commandLine).then(result => {
    console.log(result);
  }).catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}