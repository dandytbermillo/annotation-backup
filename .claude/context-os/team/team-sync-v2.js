#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * Team Sync Manager V2 - Safe, opt-in collaboration with voting
 */
class TeamSyncManagerV2 {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.teamRoot = path.join(contextRoot, 'team');
    this.configPath = path.join(contextRoot, 'config', 'settings.json');
    this.votesPath = path.join(this.teamRoot, 'votes');
    this.conflictsPath = path.join(this.teamRoot, 'conflicts');
    this.auditPath = path.join(this.teamRoot, 'audit.log');
  }

  async initialize() {
    await fs.mkdir(this.teamRoot, { recursive: true });
    await fs.mkdir(this.votesPath, { recursive: true });
    await fs.mkdir(this.conflictsPath, { recursive: true });
  }

  /**
   * Check if team features are enabled
   */
  async isEnabled() {
    const config = JSON.parse(await fs.readFile(this.configPath, 'utf8'));
    return config.team?.enabled === true;
  }

  /**
   * Enable team features (requires explicit user action)
   */
  async enableTeam(options = {}) {
    console.log('🚀 Enabling team features...');
    
    // Require explicit confirmation
    if (!options.confirmed) {
      console.log('\n⚠️  WARNING: Team features will:');
      console.log('  - Create git hooks (disabled by default)');
      console.log('  - Enable knowledge sharing (manual sync only)');
      console.log('  - Require review for all shared knowledge');
      console.log('  - Log all team sync activities');
      console.log('\nRun with --confirmed to proceed');
      return false;
    }
    
    // Update config
    const config = JSON.parse(await fs.readFile(this.configPath, 'utf8'));
    config.team.enabled = true;
    config.team.sync_frequency = 'manual';
    config.team.review_required = true;
    config.team.auto_propagate = false;
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    
    // Create team config
    await this.createTeamConfig();
    
    // Log the action
    await this.auditLog('team_enabled', { enabledBy: process.env.USER });
    
    console.log('✓ Team features enabled (manual sync only)');
    console.log('✓ All sharing requires explicit review');
    console.log('✓ Audit logging enabled');
    
    return true;
  }

  /**
   * Create team configuration
   */
  async createTeamConfig() {
    const teamConfigPath = path.join(this.teamRoot, 'team-config.json');
    const defaultConfig = {
      version: '2.0.0',
      created: new Date().toISOString(),
      members: [
        {
          id: crypto.randomBytes(8).toString('hex'),
          name: process.env.USER || 'unknown',
          role: 'contributor',
          votingWeight: 1.0,
          joinedAt: new Date().toISOString()
        }
      ],
      voting: {
        minVotes: 2,
        requireMajority: true,
        vetoRoles: ['lead', 'architect'],
        timeoutHours: 48,
        anonymousVotes: false
      },
      sharing: {
        requireReview: true,
        minConfidence: 3.0,
        minUsageCount: 5,
        excludePatterns: [
          '**/personal/**',
          '**/draft/**',
          '**/temp/**'
        ]
      },
      sync: {
        method: 'git',
        branch: 'knowledge-share',
        remote: null, // Must be configured
        lastSync: null
      }
    };
    
    await fs.writeFile(teamConfigPath, JSON.stringify(defaultConfig, null, 2));
  }

  /**
   * Create a voting issue for team decision
   */
  async createVote(options) {
    if (!await this.isEnabled()) {
      throw new Error('Team features not enabled');
    }
    
    const voteId = crypto.randomBytes(8).toString('hex');
    const vote = {
      id: voteId,
      type: options.type || 'knowledge_share',
      title: options.title,
      description: options.description,
      artifact: options.artifact,
      proposedBy: process.env.USER || 'unknown',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      status: 'open',
      votes: {},
      comments: [],
      metadata: options.metadata || {}
    };
    
    // Save vote
    const votePath = path.join(this.votesPath, `${voteId}.json`);
    await fs.writeFile(votePath, JSON.stringify(vote, null, 2));
    
    // Log the action
    await this.auditLog('vote_created', { voteId, type: vote.type });
    
    console.log(`\n🗳️  Vote created: ${voteId}`);
    console.log(`Title: ${vote.title}`);
    console.log(`Expires: ${vote.expiresAt}`);
    console.log(`\nTeam members can vote with:`);
    console.log(`  context team vote ${voteId} [approve|reject|abstain]`);
    
    return vote;
  }

  /**
   * Cast a vote
   */
  async castVote(voteId, decision, reason = '') {
    if (!await this.isEnabled()) {
      throw new Error('Team features not enabled');
    }
    
    const votePath = path.join(this.votesPath, `${voteId}.json`);
    const vote = JSON.parse(await fs.readFile(votePath, 'utf8'));
    
    if (vote.status !== 'open') {
      throw new Error(`Vote ${voteId} is ${vote.status}`);
    }
    
    if (new Date(vote.expiresAt) < new Date()) {
      vote.status = 'expired';
      await fs.writeFile(votePath, JSON.stringify(vote, null, 2));
      throw new Error(`Vote ${voteId} has expired`);
    }
    
    const voter = process.env.USER || 'unknown';
    
    // Record vote
    vote.votes[voter] = {
      decision,
      reason,
      timestamp: new Date().toISOString()
    };
    
    // Check if we have enough votes
    await this.checkVoteComplete(vote);
    
    // Save updated vote
    await fs.writeFile(votePath, JSON.stringify(vote, null, 2));
    
    // Log the action
    await this.auditLog('vote_cast', { voteId, voter, decision });
    
    console.log(`✓ Vote recorded: ${decision}`);
    
    if (vote.status === 'open') {
      const voteCount = Object.keys(vote.votes).length;
      console.log(`Current votes: ${voteCount}`);
    } else {
      console.log(`Vote result: ${vote.status}`);
    }
    
    return vote;
  }

  /**
   * Check if vote is complete
   */
  async checkVoteComplete(vote) {
    const teamConfig = JSON.parse(
      await fs.readFile(path.join(this.teamRoot, 'team-config.json'), 'utf8')
    );
    
    const voteCount = Object.keys(vote.votes).length;
    const minVotes = teamConfig.voting.minVotes;
    
    if (voteCount < minVotes) {
      return false;
    }
    
    // Count decisions
    const decisions = { approve: 0, reject: 0, abstain: 0 };
    const vetoVotes = [];
    
    for (const [voter, voteData] of Object.entries(vote.votes)) {
      decisions[voteData.decision]++;
      
      // Check for veto
      const member = teamConfig.members.find(m => m.name === voter);
      if (member && teamConfig.voting.vetoRoles.includes(member.role)) {
        if (voteData.decision === 'reject') {
          vetoVotes.push(voter);
        }
      }
    }
    
    // Check for veto
    if (vetoVotes.length > 0) {
      vote.status = 'rejected';
      vote.result = {
        reason: 'vetoed',
        vetoedBy: vetoVotes,
        decisions
      };
      return true;
    }
    
    // Check for majority
    const totalVotes = decisions.approve + decisions.reject;
    if (teamConfig.voting.requireMajority) {
      if (decisions.approve > totalVotes / 2) {
        vote.status = 'approved';
        vote.result = { decisions };
      } else if (decisions.reject > totalVotes / 2) {
        vote.status = 'rejected';
        vote.result = { decisions };
      }
    } else {
      // Simple plurality
      if (decisions.approve > decisions.reject) {
        vote.status = 'approved';
        vote.result = { decisions };
      } else {
        vote.status = 'rejected';
        vote.result = { decisions };
      }
    }
    
    return vote.status !== 'open';
  }

  /**
   * Share knowledge with team (requires vote)
   */
  async shareKnowledge(knowledgeId, metadata = {}) {
    if (!await this.isEnabled()) {
      throw new Error('Team features not enabled');
    }
    
    // Create vote for sharing
    const vote = await this.createVote({
      type: 'knowledge_share',
      title: `Share knowledge: ${knowledgeId}`,
      description: `Proposal to share knowledge entry "${knowledgeId}" with the team`,
      artifact: knowledgeId,
      metadata
    });
    
    return vote;
  }

  /**
   * Handle conflicts
   */
  async createConflict(conflict) {
    const conflictId = crypto.randomBytes(8).toString('hex');
    const conflictData = {
      id: conflictId,
      ...conflict,
      createdAt: new Date().toISOString(),
      status: 'unresolved',
      resolution: null
    };
    
    const conflictPath = path.join(this.conflictsPath, `${conflictId}.json`);
    await fs.writeFile(conflictPath, JSON.stringify(conflictData, null, 2));
    
    // Create vote for resolution
    const vote = await this.createVote({
      type: 'conflict_resolution',
      title: `Resolve conflict: ${conflict.description}`,
      description: `Conflict in ${conflict.file}: ${conflict.details}`,
      artifact: conflictId,
      metadata: { conflictType: conflict.type }
    });
    
    return { conflict: conflictData, vote };
  }

  /**
   * Audit log for all team actions
   */
  async auditLog(action, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      user: process.env.USER || 'unknown',
      data,
      environment: {
        hostname: require('os').hostname(),
        platform: process.platform,
        nodeVersion: process.version
      }
    };
    
    const logLine = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.auditPath, logLine);
  }

  /**
   * Get team status
   */
  async getStatus() {
    if (!await this.isEnabled()) {
      return { enabled: false };
    }
    
    const teamConfig = JSON.parse(
      await fs.readFile(path.join(this.teamRoot, 'team-config.json'), 'utf8')
    );
    
    // Count votes
    const voteFiles = await fs.readdir(this.votesPath).catch(() => []);
    const votes = { open: 0, approved: 0, rejected: 0, expired: 0 };
    
    for (const file of voteFiles) {
      if (file.endsWith('.json')) {
        const vote = JSON.parse(
          await fs.readFile(path.join(this.votesPath, file), 'utf8')
        );
        votes[vote.status]++;
      }
    }
    
    // Count conflicts
    const conflictFiles = await fs.readdir(this.conflictsPath).catch(() => []);
    const conflicts = conflictFiles.filter(f => f.endsWith('.json')).length;
    
    return {
      enabled: true,
      members: teamConfig.members.length,
      votes,
      conflicts,
      lastSync: teamConfig.sync.lastSync,
      config: {
        requireReview: teamConfig.sharing.requireReview,
        minVotes: teamConfig.voting.minVotes,
        syncMethod: teamConfig.sync.method
      }
    };
  }

  /**
   * List open votes
   */
  async listVotes(status = 'open') {
    if (!await this.isEnabled()) {
      throw new Error('Team features not enabled');
    }
    
    const voteFiles = await fs.readdir(this.votesPath).catch(() => []);
    const votes = [];
    
    for (const file of voteFiles) {
      if (file.endsWith('.json')) {
        const vote = JSON.parse(
          await fs.readFile(path.join(this.votesPath, file), 'utf8')
        );
        if (status === 'all' || vote.status === status) {
          votes.push(vote);
        }
      }
    }
    
    // Sort by creation date
    votes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return votes;
  }
}

module.exports = { TeamSyncManagerV2 };

// CLI interface
if (require.main === module) {
  const manager = new TeamSyncManagerV2(path.join(__dirname, '..'));
  
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  (async () => {
    await manager.initialize();
    
    switch (command) {
      case 'enable':
        const confirmed = args.includes('--confirmed');
        await manager.enableTeam({ confirmed });
        break;
        
      case 'status':
        const status = await manager.getStatus();
        if (!status.enabled) {
          console.log('Team features: DISABLED');
          console.log('Run "context team enable --confirmed" to enable');
        } else {
          console.log('Team features: ENABLED');
          console.log(`Members: ${status.members}`);
          console.log(`Open votes: ${status.votes.open}`);
          console.log(`Unresolved conflicts: ${status.conflicts}`);
          console.log(`\nConfiguration:`);
          console.log(`  Review required: ${status.config.requireReview}`);
          console.log(`  Min votes: ${status.config.minVotes}`);
          console.log(`  Sync method: ${status.config.syncMethod}`);
        }
        break;
        
      case 'vote':
        if (args.length < 2) {
          console.log('Usage: team-sync vote <vote-id> <approve|reject|abstain> [reason]');
          process.exit(1);
        }
        await manager.castVote(args[0], args[1], args.slice(2).join(' '));
        break;
        
      case 'list-votes':
        const votes = await manager.listVotes(args[0] || 'open');
        if (votes.length === 0) {
          console.log('No votes found');
        } else {
          console.log(`\nVotes (${args[0] || 'open'}):`);
          for (const vote of votes) {
            console.log(`\n${vote.id}: ${vote.title}`);
            console.log(`  Status: ${vote.status}`);
            console.log(`  Created: ${vote.createdAt}`);
            console.log(`  Votes: ${Object.keys(vote.votes).length}`);
          }
        }
        break;
        
      case 'share':
        if (args.length === 0) {
          console.log('Usage: team-sync share <knowledge-id>');
          process.exit(1);
        }
        const vote = await manager.shareKnowledge(args[0]);
        console.log(`\nCreated vote ${vote.id} to share knowledge`);
        break;
        
      default:
        console.log('Usage: team-sync [enable|status|vote|list-votes|share]');
    }
  })().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}