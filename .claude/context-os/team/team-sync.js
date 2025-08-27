#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

/**
 * Team Sync Manager - Git-based knowledge sharing and collaboration
 */
class TeamSyncManager {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.teamRoot = path.join(contextRoot, 'team');
    this.configPath = path.join(this.teamRoot, 'team.yaml');
    this.syncLog = path.join(this.teamRoot, '.sync-log.json');
  }

  async initialize() {
    await fs.mkdir(this.teamRoot, { recursive: true });
    
    // Check if team config exists
    try {
      await fs.access(this.configPath);
    } catch {
      await this.createDefaultConfig();
    }
  }

  async createDefaultConfig() {
    const defaultConfig = `team:
  mode: "distributed"  # or "centralized"
  
  knowledge_sync:
    method: "git-subtree"  # or "s3", "shared-drive"
    frequency: "on-commit"
    remote: "origin/knowledge-share"
    
  conflict_resolution:
    current_tasks: "branch-specific"
    knowledge: "merge-with-voting"
    
  patterns:
    share: true
    review_required: false
    auto_propagate: true
    
  members:
    - name: "${process.env.USER || 'developer'}"
      role: "contributor"
      voting_weight: 1.0
`;
    
    await fs.writeFile(this.configPath, defaultConfig);
  }

  /**
   * Enable team collaboration
   */
  async enableTeam() {
    console.log('🚀 Enabling team features...');
    
    // Install git hooks
    await this.installGitHooks();
    
    // Setup knowledge sharing branch
    await this.setupKnowledgeSharing();
    
    // Initialize sync tracking
    await this.initializeSyncTracking();
    
    console.log('✓ Git hooks installed (prevent conflicts)');
    console.log('✓ Shared patterns repo linked');
    console.log('✓ Team knowledge sync enabled');
    console.log('✓ Conflict resolution tools added');
  }

  /**
   * Install git hooks for team collaboration
   */
  async installGitHooks() {
    const gitHooksDir = path.join(this.contextRoot, '..', '..', '.git', 'hooks');
    
    // Pre-commit hook
    const preCommitHook = `#!/bin/bash
# Context OS Team Sync Pre-commit Hook

# Check for context conflicts
if git diff --cached --name-only | grep -q ".context/current/"; then
  echo "⚠️  Context OS: Checking for task conflicts..."
  node ${path.join(this.contextRoot, 'team', 'check-conflicts.js')}
  if [ $? -ne 0 ]; then
    echo "❌ Context conflicts detected. Please resolve before committing."
    exit 1
  fi
fi

# Sync knowledge if changed
if git diff --cached --name-only | grep -q ".context/knowledge/"; then
  echo "📚 Context OS: Preparing knowledge sync..."
  node ${path.join(this.contextRoot, 'team', 'prepare-sync.js')}
fi
`;
    
    await fs.writeFile(path.join(gitHooksDir, 'pre-commit'), preCommitHook);
    await fs.chmod(path.join(gitHooksDir, 'pre-commit'), '755');
    
    // Post-merge hook
    const postMergeHook = `#!/bin/bash
# Context OS Team Sync Post-merge Hook

echo "🔄 Context OS: Syncing team knowledge..."
node ${path.join(this.contextRoot, 'team', 'sync-knowledge.js')}
`;
    
    await fs.writeFile(path.join(gitHooksDir, 'post-merge'), postMergeHook);
    await fs.chmod(path.join(gitHooksDir, 'post-merge'), '755');
  }

  /**
   * Setup knowledge sharing branch
   */
  async setupKnowledgeSharing() {
    try {
      // Check if knowledge-share branch exists
      execSync('git show-ref --verify --quiet refs/heads/knowledge-share');
    } catch {
      // Create knowledge-share branch
      execSync('git checkout -b knowledge-share');
      execSync('git checkout -');
    }
  }

  /**
   * Initialize sync tracking
   */
  async initializeSyncTracking() {
    const initialLog = {
      lastSync: new Date().toISOString(),
      syncHistory: [],
      conflicts: [],
      sharedPatterns: []
    };
    
    await fs.writeFile(this.syncLog, JSON.stringify(initialLog, null, 2));
  }

  /**
   * Share knowledge patterns
   */
  async sharePatterns(patterns) {
    const config = await this.loadConfig();
    
    if (!config.team.patterns.share) {
      console.log('Pattern sharing is disabled');
      return;
    }
    
    // Prepare patterns for sharing
    const shareablePatterns = patterns.filter(p => 
      p.metadata.confidence >= 2.0 && 
      p.metadata.usage >= 3
    );
    
    if (shareablePatterns.length === 0) {
      console.log('No patterns meet sharing criteria');
      return;
    }
    
    // Create share manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      author: process.env.USER || 'unknown',
      patterns: shareablePatterns.map(p => ({
        id: p.id,
        category: p.category,
        title: this.extractTitle(p.content),
        confidence: p.metadata.confidence,
        usage: p.metadata.usage
      }))
    };
    
    // Stage patterns for commit
    const shareDir = path.join(this.contextRoot, 'team', 'shared');
    await fs.mkdir(shareDir, { recursive: true });
    
    for (const pattern of shareablePatterns) {
      const filename = `${pattern.id}.json`;
      await fs.writeFile(
        path.join(shareDir, filename),
        JSON.stringify(pattern, null, 2)
      );
    }
    
    await fs.writeFile(
      path.join(shareDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log(`✓ Prepared ${shareablePatterns.length} patterns for sharing`);
  }

  /**
   * Pull shared knowledge from team
   */
  async pullSharedKnowledge() {
    console.log('🔄 Pulling shared knowledge...');
    
    try {
      // Fetch latest from knowledge-share branch
      execSync('git fetch origin knowledge-share:knowledge-share');
      
      // Get shared patterns
      const sharedDir = path.join(this.contextRoot, 'team', 'shared');
      const files = await fs.readdir(sharedDir).catch(() => []);
      
      const patterns = [];
      for (const file of files) {
        if (file.endsWith('.json') && file !== 'manifest.json') {
          const content = await fs.readFile(path.join(sharedDir, file), 'utf8');
          patterns.push(JSON.parse(content));
        }
      }
      
      console.log(`✓ Found ${patterns.length} shared patterns`);
      return patterns;
      
    } catch (error) {
      console.error('Failed to pull shared knowledge:', error.message);
      return [];
    }
  }

  /**
   * Check for conflicts
   */
  async checkConflicts() {
    const conflicts = [];
    
    // Check current tasks
    const currentDir = path.join(this.contextRoot, 'current');
    const stagedFiles = execSync('git diff --cached --name-only').toString().split('\n');
    
    for (const file of stagedFiles) {
      if (file.startsWith('.context/current/')) {
        // Check if file exists in other branches
        try {
          const branches = execSync('git branch -r --contains HEAD').toString();
          if (branches.split('\n').length > 1) {
            conflicts.push({
              file,
              type: 'concurrent_task',
              message: 'Task file exists in multiple branches'
            });
          }
        } catch {}
      }
    }
    
    // Check knowledge merges
    const knowledgeFiles = stagedFiles.filter(f => f.startsWith('.context/knowledge/'));
    for (const file of knowledgeFiles) {
      // Check if content has diverged significantly
      try {
        const baseContent = execSync(`git show HEAD:${file}`).toString();
        const newContent = await fs.readFile(file, 'utf8');
        
        if (this.hasMajorDivergence(baseContent, newContent)) {
          conflicts.push({
            file,
            type: 'knowledge_divergence',
            message: 'Knowledge has diverged significantly'
          });
        }
      } catch {}
    }
    
    return conflicts;
  }

  /**
   * Resolve conflicts with voting
   */
  async resolveConflicts(conflicts) {
    const config = await this.loadConfig();
    const resolutionMethod = config.team.conflict_resolution.knowledge;
    
    if (resolutionMethod === 'merge-with-voting') {
      // Implement voting mechanism
      console.log('🗳️  Conflict resolution requires team voting');
      
      for (const conflict of conflicts) {
        // Create voting issue
        const vote = {
          id: crypto.randomBytes(8).toString('hex'),
          conflict,
          created: new Date().toISOString(),
          votes: {},
          status: 'pending'
        };
        
        // Save to team votes
        const votesDir = path.join(this.teamRoot, 'votes');
        await fs.mkdir(votesDir, { recursive: true });
        await fs.writeFile(
          path.join(votesDir, `${vote.id}.json`),
          JSON.stringify(vote, null, 2)
        );
        
        console.log(`Vote created: ${vote.id} for ${conflict.file}`);
      }
    }
  }

  /**
   * Check for major divergence
   */
  hasMajorDivergence(content1, content2) {
    // Simple heuristic: if more than 50% of lines changed
    const lines1 = content1.split('\n');
    const lines2 = content2.split('\n');
    
    const commonLines = lines1.filter(line => lines2.includes(line));
    const similarity = commonLines.length / Math.max(lines1.length, lines2.length);
    
    return similarity < 0.5;
  }

  /**
   * Extract title from content
   */
  extractTitle(content) {
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('#')) {
        return line.replace(/^#+\s+/, '');
      }
    }
    return content.substring(0, 50) + '...';
  }

  /**
   * Load team configuration
   */
  async loadConfig() {
    const content = await fs.readFile(this.configPath, 'utf8');
    const yaml = require('js-yaml');
    return yaml.load(content);
  }

  /**
   * Sync knowledge with team
   */
  async syncKnowledge() {
    const syncLog = JSON.parse(await fs.readFile(this.syncLog, 'utf8'));
    
    // Pull latest shared knowledge
    const sharedPatterns = await this.pullSharedKnowledge();
    
    // Import new patterns
    let imported = 0;
    const knowledgeManager = require('../core/knowledge-manager');
    const km = new knowledgeManager.KnowledgeManager(this.contextRoot);
    await km.initialize();
    
    for (const pattern of sharedPatterns) {
      // Check if pattern already exists
      const existing = km.index.get(pattern.id);
      if (!existing) {
        await km.saveEntry(pattern);
        await km.updateIndex(pattern);
        imported++;
      }
    }
    
    // Update sync log
    syncLog.lastSync = new Date().toISOString();
    syncLog.syncHistory.push({
      timestamp: syncLog.lastSync,
      imported,
      total: sharedPatterns.length
    });
    
    await fs.writeFile(this.syncLog, JSON.stringify(syncLog, null, 2));
    
    console.log(`✓ Synced ${imported} new patterns from team`);
  }
}

module.exports = { TeamSyncManager };

// CLI interface
if (require.main === module) {
  const manager = new TeamSyncManager(path.join(__dirname, '..'));
  
  const command = process.argv[2];
  
  (async () => {
    await manager.initialize();
    
    switch (command) {
      case 'enable':
        await manager.enableTeam();
        break;
      case 'sync':
        await manager.syncKnowledge();
        break;
      case 'share':
        // Would need to load patterns first
        console.log('Use: context share patterns/*');
        break;
      case 'pull':
        const patterns = await manager.pullSharedKnowledge();
        console.log(`Found ${patterns.length} shared patterns`);
        break;
      default:
        console.log('Usage: team-sync [enable|sync|share|pull]');
    }
  })();
}