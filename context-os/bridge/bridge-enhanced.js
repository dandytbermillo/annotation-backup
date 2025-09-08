/**
 * Production-Ready Bridge with Expert's Safety Improvements
 */

const { CommandRouter } = require('./command-routing');
const { ClaudeAdapter } = require('./claude-adapter');
const { execContextOS } = require('./contextos-adapter');
const ImageHandler = require('./image-handler');
const fs = require('fs');
const path = require('path');

class ContextOSClaudeBridge {
  constructor(options = {}) {
    // Initialize adapters
    this.claudeAdapter = options.claude || new ClaudeAdapter();
    this.commandRouter = new CommandRouter();
    this.imageHandler = new ImageHandler();
    
    this.budget = {
      maxTokensPerCall: 4000,
      maxToolsPerCall: 3,
      maxParallelCalls: 2,
      maxRetries: 2,
      timeoutMs: 30000,
      ...options.budget
    };
    
    // Failure Priority Tiers
    this.failureTiers = {
      CRITICAL: {
        maxRetries: 3,
        backoffMs: [1000, 2000, 4000],
        fallbackStrategy: 'immediate',
        action: 'retry-with-backoff-then-degrade'
      },
      IMPORTANT: {
        maxRetries: 2,
        backoffMs: [500, 1500],
        fallbackStrategy: 'after-retry',
        action: 'retry-once-then-fallback'
      },
      OPTIONAL: {
        maxRetries: 1,
        backoffMs: [500],
        fallbackStrategy: 'skip',
        action: 'try-once-then-skip'
      }
    };
    
    // Safety: track usage for this session
    this.usage = {
      tokensUsed: 0,
      callsMade: 0,
      errors: []
    };
    
    // Telemetry tracking
    this.telemetry = {
      entries: []
    };
    
    // Telemetry path
    this.telemetryPath = options.telemetryPath || 'docs/documentation_process_guide/telemetry';
    this.sessionId = Date.now().toString(36);
  }
  
  async execute(rawCommand, priority = 'IMPORTANT', attachments = []) {
    const startTime = Date.now();
    const route = this.commandRouter.route(rawCommand);
    
    // Set failure handling tier
    route.priority = priority;
    route.tier = this.failureTiers[priority] || this.failureTiers.IMPORTANT;
    
    // Parse arguments from matches
    route.args = route.matches || [];
    
    // SAFETY: Default to dry-run for write operations
    if (this.isWriteOperation(route.command) && !route.args.includes('--apply')) {
      route.dryRun = true;
      console.log('🔒 Safety: Running in dry-run mode. Add --apply to execute.');
    }
    
    const parts = {
      route,
      claudeResults: null,
      contextResults: null,
      logs: [],
      artifacts: [],
      imageProcessing: null
    };
    
    try {
      // Process images for /fix command if attachments present
      if (route.command === '/fix' && attachments.length > 0) {
        console.log(`📸 Processing ${attachments.length} image(s) for fix command...`);
        
        // Parse fix command parameters
        const featureMatch = route.args[0]?.match(/--feature\s+(\S+)/);
        const issueMatch = route.args[0]?.match(/--issue\s+"([^"]+)"/);
        
        const params = {
          feature: featureMatch?.[1] || route.args[0],
          issue: issueMatch?.[1] || route.args[1] || route.args[0],
          // Visual findings would come from Claude's analysis
          visualFindings: attachments.map((att, i) => 
            `Visual finding ${i+1} from ${att.name || 'image'}`
          )
        };
        
        // Process images through handler
        const imageResult = await this.imageHandler.processCommand('fix', params, attachments);
        parts.imageProcessing = imageResult;
        
        if (imageResult.success && imageResult.enrichedParams) {
          // Update route args with enriched issue text
          route.enrichedIssue = imageResult.enrichedParams.issue;
          // Store telemetry
          this.telemetry.imagesCaptured = imageResult.telemetry.imagesCaptured;
          this.telemetry.imagesBound = imageResult.telemetry.imagesBound;
        }
      }
      
      // Execute Claude agent if needed
      if (route.claudeAgent) {
        parts.claudeResults = await this.executeClaudeWithBudget(route);
      }
      
      // Execute Context-OS agent if needed
      if (route.contextAgent) {
        // If we have enriched issue text, update the route
        if (route.enrichedIssue) {
          route.args[1] = route.enrichedIssue;
        }
        parts.contextResults = await this.executeContextOSWithSafety(route);
      }
      
      // Combine results if hybrid
      const result = route.hybrid 
        ? this.combineResults(parts)
        : (parts.claudeResults || parts.contextResults);
      
      // SAFETY: Always validate result structure
      this.validateResult(result);
      
      // Emit telemetry
      await this.emitTelemetry({
        command: rawCommand,
        route: route.hybrid ? 'hybrid' : (route.claudeAgent ? 'claude-only' : 'context-only'),
        claudeTools: route.claudeAgent ? ['Task'] : [],
        contextOSExecuted: !!route.contextAgent,
        tokenEstimate: this.usage.tokensUsed,
        duration: Date.now() - startTime,
        exitStatus: result.status === 'ok' ? 'success' : (result.status === 'degraded' ? 'degraded' : 'failure'),
        artifacts: result.artifacts,
        imagesCaptured: this.telemetry.imagesCaptured || 0,
        imagesBound: this.telemetry.imagesBound || 0
      });
      
      return result;
      
    } catch (error) {
      // Apply failure tier handling
      return await this.handleFailureWithTier(error, route, parts);
    }
  }
  
  /**
   * Handle failures based on priority tier
   */
  async handleFailureWithTier(error, route, parts) {
    const tier = route.tier;
    console.error(`⚠️  ${route.priority} failure: ${error.message}`);
    
    // Apply tier-specific strategy
    switch (tier.action) {
      case 'retry-with-backoff-then-degrade':
        // CRITICAL: Aggressive retry with exponential backoff
        for (let i = 0; i < tier.maxRetries; i++) {
          console.log(`🔄 Retry ${i + 1}/${tier.maxRetries} after ${tier.backoffMs[i]}ms...`);
          await this.sleep(tier.backoffMs[i]);
          
          try {
            // Retry the entire operation
            if (route.claudeAgent && !parts.claudeResults) {
              parts.claudeResults = await this.executeClaudeWithBudget(route);
            }
            if (route.contextAgent && !parts.contextResults) {
              parts.contextResults = await this.executeContextOSWithSafety(route);
            }
            
            // Success after retry
            return route.hybrid 
              ? this.combineResults(parts)
              : (parts.claudeResults || parts.contextResults);
          } catch (retryError) {
            console.error(`  Retry ${i + 1} failed: ${retryError.message}`);
          }
        }
        
        // All retries failed, try degraded mode
        if (route.contextAgent) {
          try {
            parts.contextResults = await this.executeContextOSWithSafety(route);
            return {
              status: 'degraded',
              summary: 'CRITICAL operation degraded to Context-OS only',
              tier: 'CRITICAL',
              retriesExhausted: true,
              ...parts.contextResults
            };
          } catch (degradeError) {
            // Complete failure for CRITICAL
            return {
              status: 'error',
              tier: 'CRITICAL',
              summary: `CRITICAL failure after ${tier.maxRetries} retries`,
              error: error.message,
              degradeError: degradeError.message
            };
          }
        }
        break;
        
      case 'retry-once-then-fallback':
        // IMPORTANT: Single retry then fallback
        for (let i = 0; i < tier.maxRetries; i++) {
          await this.sleep(tier.backoffMs[i]);
          
          try {
            if (route.claudeAgent && !parts.claudeResults) {
              parts.claudeResults = await this.executeClaudeWithBudget(route);
              return parts.claudeResults;
            }
          } catch (retryError) {
            // Try fallback
            if (route.contextAgent) {
              try {
                parts.contextResults = await this.executeContextOSWithSafety(route);
                return {
                  status: 'degraded',
                  summary: 'IMPORTANT operation fell back to Context-OS',
                  tier: 'IMPORTANT',
                  ...parts.contextResults
                };
              } catch (fallbackError) {
                // Fallback failed
              }
            }
          }
        }
        break;
        
      case 'try-once-then-skip':
        // OPTIONAL: Single attempt, skip on failure
        console.log('🛡 OPTIONAL operation skipped after failure');
        return {
          status: 'skipped',
          tier: 'OPTIONAL',
          summary: 'Optional operation skipped',
          reason: error.message
        };
    }
    
    // Default error response
    return {
      status: 'error',
      tier: route.priority,
      summary: `Operation failed: ${error.message}`,
      logs: [String(error)]
    };
  }
  
  /**
   * Sleep helper for backoff
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Execute Claude with budget controls
   */
  async executeClaudeWithBudget(route) {
    // Check budget
    if (this.usage.tokensUsed >= this.budget.maxTokensPerCall * 10) {
      throw new Error('Token budget exceeded for session');
    }
    
    const request = this.formatForClaude(route);
    
    // Add budget constraints to request
    request.budget = {
      maxTokens: this.budget.maxTokensPerCall,
      maxTools: this.budget.maxToolsPerCall,
      timeoutMs: this.budget.timeoutMs
    };
    
    try {
      const response = await this.claudeAdapter.invokeTask(request);
      
      // Track usage
      if (response.metadata) {
        this.usage.tokensUsed += response.metadata.tokensUsed || 0;
        this.usage.callsMade += 1;
      }
      
      return this.parseClaudeResponse(response);
      
    } catch (error) {
      this.usage.errors.push({
        time: new Date().toISOString(),
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Execute Context-OS with safety checks
   */
  async executeContextOSWithSafety(route) {
    const result = await execContextOS(route);
    
    // SAFETY: If write operation, ensure patch is created
    if (this.isWriteOperation(route.command) && !route.dryRun) {
      if (!result.patchPath) {
        // Generate patch for safety
        result.patchPath = await this.generatePatch(result.changes);
      }
    }
    
    return result;
  }
  
  /**
   * Format request for Claude
   */
  formatForClaude(route) {
    const taskTemplates = {
      '/analyze': `Analyze the feature "${route.args[0]}" for patterns, issues, and improvements`,
      '/fix': `Analyze this issue: "${route.args[1]}" in feature "${route.args[0]}"`,
      '/review': `Review the implementation of "${route.args[0]}" for quality and best practices`,
      '/migrate': `Understand the structure of "${route.args[0]}" for migration to "${route.args[1]}"`
    };
    
    return {
      task: taskTemplates[route.command] || `Execute ${route.command}`,
      context: {
        feature: route.args[0],
        additionalArgs: route.args.slice(1)
      },
      tools: route.tools || ['Task', 'Grep', 'Read']
    };
  }
  
  /**
   * Parse Claude response with validation
   */
  parseClaudeResponse(response) {
    // Strict schema validation
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid Claude response format');
    }
    
    return {
      status: response.status || 'error',
      findings: Array.isArray(response.findings) ? response.findings : [],
      recommendations: Array.isArray(response.recommendations) ? response.recommendations : [],
      confidence: typeof response.confidence === 'number' ? response.confidence : 0,
      logs: Array.isArray(response.logs) ? response.logs : [],
      metadata: response.metadata || {}
    };
  }
  
  /**
   * Combine Claude and Context-OS results
   */
  combineResults({ claudeResults, contextResults, logs }) {
    // Prefer deterministic artifacts from Context-OS
    const artifacts = {};
    
    if (contextResults?.reportPath) {
      artifacts.report = contextResults.reportPath;
    }
    if (contextResults?.patchPath) {
      artifacts.patch = contextResults.patchPath;
    }
    
    // Combine findings
    const allFindings = [
      ...(claudeResults?.findings || []),
      ...(contextResults?.changes || [])
    ];
    
    return {
      status: this.determineOverallStatus(claudeResults, contextResults),
      summary: this.generateSummary(claudeResults, contextResults),
      artifacts,
      findings: allFindings,
      recommendations: claudeResults?.recommendations || [],
      diffs: contextResults?.diffs || [],
      logs: [
        ...(claudeResults?.logs || []),
        ...(contextResults?.logs || []),
        ...logs
      ]
    };
  }
  
  /**
   * Determine overall status from multiple results
   */
  determineOverallStatus(claudeResults, contextResults) {
    if (claudeResults?.status === 'error' || contextResults?.status === 'error') {
      return 'error';
    }
    if (claudeResults?.status === 'degraded' || contextResults?.status === 'partial') {
      return 'degraded';
    }
    return 'ok';
  }
  
  /**
   * Generate human-readable summary
   */
  generateSummary(claudeResults, contextResults) {
    const parts = [];
    
    if (claudeResults) {
      parts.push(`Claude found ${claudeResults.findings?.length || 0} items`);
    }
    if (contextResults) {
      if (contextResults.patchPath) {
        parts.push(`Generated patch at ${contextResults.patchPath}`);
      }
      if (contextResults.reportPath) {
        parts.push(`Report at ${contextResults.reportPath}`);
      }
    }
    
    return parts.join('. ') || 'Operation completed';
  }
  
  /**
   * Check if operation modifies files
   */
  isWriteOperation(command) {
    return ['/execute', '/fix', '/migrate'].includes(command);
  }
  
  /**
   * Generate patch file for safety
   */
  async generatePatch(changes) {
    if (!changes || changes.length === 0) return null;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const patchPath = `patches/bridge-${timestamp}.patch`;
    
    // Create patch content
    const patchContent = changes.map(change => 
      `--- ${change.file}\n+++ ${change.file}\n${change.diff}`
    ).join('\n\n');
    
    fs.writeFileSync(patchPath, patchContent);
    return patchPath;
  }
  
  /**
   * Validate result structure
   */
  validateResult(result) {
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid result structure');
    }
    if (!result.status) {
      result.status = 'unknown';
    }
    if (!result.summary) {
      result.summary = 'No summary available';
    }
  }
  
  /**
   * Emit telemetry for observability
   */
  async emitTelemetry(event) {
    const telemetry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      command: event.command,
      route: event.route,
      claudeTools: event.claudeTools || [],
      contextOSExecuted: event.contextOSExecuted || false,
      tokenEstimate: event.tokenEstimate || 0,
      duration: event.duration,
      exitStatus: event.exitStatus,
      imagesCaptured: event.imagesCaptured || 0,
      imagesBound: event.imagesBound || 0,
      artifacts: event.artifacts || []
    };
    
    // Store in memory
    this.telemetry.entries.push(telemetry);
    
    // Write to telemetry log
    try {
      const logDir = this.telemetryPath;
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logPath = path.join(logDir, `${this.sessionId}.jsonl`);
      fs.appendFileSync(logPath, JSON.stringify(telemetry) + '\n');
    } catch (error) {
      console.warn('Could not write telemetry:', error.message);
    }
    
    // Also log to console in dev mode
    if (process.env.NODE_ENV === 'development' || process.env.LOG_LEVEL === 'debug') {
      console.log('📊 Telemetry:', telemetry);
    }
  }
}

module.exports = { ContextOSClaudeBridge };