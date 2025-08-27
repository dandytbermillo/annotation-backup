#!/usr/bin/env node

const { TeamSyncManager } = require('./team-sync');
const path = require('path');

(async () => {
  const manager = new TeamSyncManager(path.join(__dirname, '..'));
  await manager.initialize();
  
  const conflicts = await manager.checkConflicts();
  
  if (conflicts.length > 0) {
    console.error('❌ Context conflicts detected:');
    for (const conflict of conflicts) {
      console.error(`  - ${conflict.file}: ${conflict.message}`);
    }
    process.exit(1);
  }
  
  console.log('✓ No context conflicts found');
  process.exit(0);
})();