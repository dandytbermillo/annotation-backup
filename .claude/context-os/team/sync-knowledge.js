#!/usr/bin/env node

const { TeamSyncManager } = require('./team-sync');
const path = require('path');

(async () => {
  const manager = new TeamSyncManager(path.join(__dirname, '..'));
  await manager.initialize();
  await manager.syncKnowledge();
})();