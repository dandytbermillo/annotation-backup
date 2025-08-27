#!/usr/bin/env node

const { TeamSyncManager } = require('./team-sync');
const { KnowledgeManager } = require('../core/knowledge-manager');
const path = require('path');

(async () => {
  const contextRoot = path.join(__dirname, '..');
  const teamManager = new TeamSyncManager(contextRoot);
  const knowledgeManager = new KnowledgeManager(contextRoot);
  
  await teamManager.initialize();
  await knowledgeManager.initialize();
  
  // Get high-confidence patterns
  const patterns = Array.from(knowledgeManager.index.values());
  
  // Share eligible patterns
  await teamManager.sharePatterns(patterns);
  
  console.log('✓ Knowledge sync prepared');
})();