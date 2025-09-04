/**
 * Configuration Manager
 * Handles secrets, environment variables, and budgets safely
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }
  
  /**
   * Load configuration from environment and files
   */
  loadConfig() {
    const config = {
      // Claude API Configuration
      claude: {
        apiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
        apiUrl: process.env.CLAUDE_API_URL || 'https://api.anthropic.com/v1/messages',
        model: process.env.CLAUDE_MODEL || 'claude-3-opus-20240229',
        maxRetries: parseInt(process.env.CLAUDE_MAX_RETRIES) || 2,
        mode: process.env.CLAUDE_MODE || 'mock' // 'mock' or 'real'
      },
      
      // Budget Configuration (per session)
      budget: {
        maxTokensPerCall: parseInt(process.env.MAX_TOKENS_PER_CALL) || 4000,
        maxTokensPerSession: parseInt(process.env.MAX_TOKENS_PER_SESSION) || 100000,
        maxCallsPerSession: parseInt(process.env.MAX_CALLS_PER_SESSION) || 50,
        maxParallelCalls: parseInt(process.env.MAX_PARALLEL_CALLS) || 2,
        costAlertThreshold: parseFloat(process.env.COST_ALERT_THRESHOLD) || 5.00,
        timeoutMs: parseInt(process.env.TIMEOUT_MS) || 30000
      },
      
      // Per-command budgets
      commandBudgets: {
        '/analyze': {
          maxTokens: 2000,
          maxTools: 3,
          timeout: 20000
        },
        '/fix': {
          maxTokens: 4000,
          maxTools: 5,
          timeout: 30000
        },
        '/review': {
          maxTokens: 3000,
          maxTools: 4,
          timeout: 25000
        },
        '/migrate': {
          maxTokens: 6000,
          maxTools: 6,
          timeout: 40000
        }
      },
      
      // Safety Configuration
      safety: {
        defaultDryRun: process.env.DEFAULT_DRY_RUN !== 'false',
        requireApproval: process.env.REQUIRE_APPROVAL !== 'false',
        maxPatchSize: parseInt(process.env.MAX_PATCH_SIZE) || 10000,
        backupBeforeWrite: process.env.BACKUP_BEFORE_WRITE !== 'false'
      },
      
      // Telemetry Configuration
      telemetry: {
        enabled: process.env.TELEMETRY_ENABLED !== 'false',
        path: process.env.TELEMETRY_PATH || 'context-os/telemetry',
        logLevel: process.env.LOG_LEVEL || 'info', // 'debug', 'info', 'warn', 'error'
        sendMetrics: process.env.SEND_METRICS === 'true',
        metricsEndpoint: process.env.METRICS_ENDPOINT
      },
      
      // Paths Configuration
      paths: {
        contextOS: process.env.CONTEXT_OS_PATH || process.cwd(),
        drafts: process.env.DRAFTS_PATH || 'context-os/drafts',
        proposals: process.env.PROPOSALS_PATH || '../docs/proposal',
        patches: process.env.PATCHES_PATH || 'patches',
        telemetry: process.env.TELEMETRY_PATH || 'context-os/telemetry'
      }
    };
    
    // Try to load from config file if exists
    const configFile = process.env.CONFIG_FILE || 'context-os/config.json';
    if (fs.existsSync(configFile)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        // Merge file config with env config (env takes precedence)
        config.budget = { ...fileConfig.budget, ...config.budget };
        config.commandBudgets = { ...fileConfig.commandBudgets, ...config.commandBudgets };
        config.safety = { ...fileConfig.safety, ...config.safety };
      } catch (error) {
        console.warn(`⚠️  Could not load config file: ${error.message}`);
      }
    }
    
    return config;
  }
  
  /**
   * Validate configuration and warn about missing/invalid values
   */
  validateConfig() {
    const warnings = [];
    
    // Check for Claude API key if in real mode
    if (this.config.claude.mode === 'real' && !this.config.claude.apiKey) {
      warnings.push('❌ CLAUDE_API_KEY not set - required for real mode');
      this.config.claude.mode = 'mock'; // Force mock mode
    }
    
    // Validate budget limits
    if (this.config.budget.maxTokensPerCall > 8000) {
      warnings.push('⚠️  maxTokensPerCall > 8000 may hit API limits');
    }
    
    if (this.config.budget.maxParallelCalls > 5) {
      warnings.push('⚠️  maxParallelCalls > 5 may cause rate limiting');
    }
    
    // Check paths exist
    const requiredPaths = ['contextOS'];
    for (const pathKey of requiredPaths) {
      if (!fs.existsSync(this.config.paths[pathKey])) {
        warnings.push(`⚠️  Path not found: ${pathKey} = ${this.config.paths[pathKey]}`);
      }
    }
    
    // Print warnings
    if (warnings.length > 0) {
      console.log('📋 Configuration Warnings:');
      warnings.forEach(w => console.log(`  ${w}`));
      console.log('');
    }
    
    // Log current mode
    console.log(`🤖 Claude Mode: ${this.config.claude.mode.toUpperCase()}`);
    if (this.config.safety.defaultDryRun) {
      console.log('🔒 Safety: Default dry-run enabled');
    }
  }
  
  /**
   * Get configuration value
   */
  get(path) {
    const parts = path.split('.');
    let value = this.config;
    
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }
    
    return value;
  }
  
  /**
   * Get budget for a specific command
   */
  getCommandBudget(command) {
    return this.config.commandBudgets[command] || {
      maxTokens: this.config.budget.maxTokensPerCall,
      maxTools: 3,
      timeout: this.config.budget.timeoutMs
    };
  }
  
  /**
   * Check if API key is configured
   */
  hasApiKey() {
    return !!this.config.claude.apiKey;
  }
  
  /**
   * Get safe config (no secrets)
   */
  getSafeConfig() {
    const safe = JSON.parse(JSON.stringify(this.config));
    
    // Remove sensitive values
    if (safe.claude.apiKey) {
      safe.claude.apiKey = '***' + safe.claude.apiKey.slice(-4);
    }
    
    return safe;
  }
  
  /**
   * Save example config file
   */
  saveExampleConfig(path = 'context-os/config.example.json') {
    const example = {
      budget: {
        maxTokensPerCall: 4000,
        maxTokensPerSession: 100000,
        maxCallsPerSession: 50,
        maxParallelCalls: 2,
        costAlertThreshold: 5.00
      },
      commandBudgets: {
        '/analyze': { maxTokens: 2000, maxTools: 3 },
        '/fix': { maxTokens: 4000, maxTools: 5 },
        '/review': { maxTokens: 3000, maxTools: 4 },
        '/migrate': { maxTokens: 6000, maxTools: 6 }
      },
      safety: {
        defaultDryRun: true,
        requireApproval: true,
        maxPatchSize: 10000,
        backupBeforeWrite: true
      },
      telemetry: {
        enabled: true,
        logLevel: 'info'
      }
    };
    
    fs.writeFileSync(path, JSON.stringify(example, null, 2));
    console.log(`💾 Example config saved to ${path}`);
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getConfig: () => {
    if (!instance) {
      instance = new ConfigManager();
    }
    return instance;
  },
  ConfigManager
};