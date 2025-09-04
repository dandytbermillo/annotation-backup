/**
 * Claude Adapter with Mock Mode for Testing
 * Implements expert's recommendation to start with mocked responses
 */

const fs = require('fs');
const path = require('path');

class ClaudeAdapter {
  constructor(options = {}) {
    this.mode = options.mode || 'mock'; // 'mock' | 'real'
    this.fixtures = this.loadFixtures();
    this.callCount = 0;
    this.costTracker = {
      totalTokens: 0,
      totalCost: 0,
      costPerToken: 0.00002 // Approximate
    };
  }
  
  /**
   * Load test fixtures for mock mode
   */
  loadFixtures() {
    try {
      const fixturePath = path.join(__dirname, 'test', 'fixtures.json');
      return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    } catch (error) {
      console.warn('⚠️  No fixtures found, using defaults');
      return { claudeResponses: {} };
    }
  }
  
  /**
   * Main entry point - invokes Task tool
   */
  async invokeTask(request) {
    // Validate request budget
    if (request.budget) {
      if (this.costTracker.totalTokens >= request.budget.maxTokens * 10) {
        throw new Error(`Token budget exceeded: ${this.costTracker.totalTokens} used`);
      }
    }
    
    this.callCount++;
    
    if (this.mode === 'mock') {
      return this.mockInvokeTask(request);
    } else {
      return this.realInvokeTask(request);
    }
  }
  
  /**
   * Mock implementation for testing
   */
  async mockInvokeTask(request) {
    // Simulate network delay
    await this.simulateDelay(100, 500);
    
    // Determine which fixture to use based on task
    let response;
    
    if (request.task.includes('Analyze') && request.task.includes('issue')) {
      response = this.fixtures.claudeResponses.fix_analysis;
    } else if (request.task.includes('Analyze')) {
      response = this.fixtures.claudeResponses.analyze_success;
    } else if (request.task.includes('Review')) {
      response = this.fixtures.claudeResponses.review_semantic;
    } else {
      // Default response
      response = {
        status: 'ok',
        findings: [`Mock finding for: ${request.task}`],
        recommendations: ['Mock recommendation'],
        confidence: 0.75,
        metadata: {
          tokensUsed: 500,
          toolsInvoked: request.tools || ['Task'],
          duration: 250
        }
      };
    }
    
    // Simulate token usage
    if (response.metadata?.tokensUsed) {
      this.costTracker.totalTokens += response.metadata.tokensUsed;
      this.costTracker.totalCost = this.costTracker.totalTokens * this.costTracker.costPerToken;
    }
    
    // Add request ID for tracking
    response.requestId = `mock-${Date.now()}-${this.callCount}`;
    
    console.log(`🤖 [MOCK] Claude Task executed: ${request.task.substring(0, 50)}...`);
    
    return response;
  }
  
  /**
   * Real Claude integration (placeholder for actual implementation)
   */
  async realInvokeTask(request) {
    console.log('🤖 [REAL] Invoking Claude Task tool...');
    
    // This is where you would actually integrate with Claude's Task tool
    // For now, it's a placeholder that shows the structure
    
    try {
      // In real implementation:
      // 1. Format request for Claude's API
      // 2. Call Claude with proper authentication
      // 3. Parse and validate response
      // 4. Track token usage
      
      const claudePayload = {
        model: 'claude-3-opus-20240229',
        max_tokens: request.budget?.maxTokens || 4000,
        messages: [
          {
            role: 'user',
            content: request.task
          }
        ],
        tools: request.tools.map(tool => ({
          type: tool.toLowerCase(),
          enabled: true
        }))
      };
      
      // Simulate API call
      console.log('📡 Calling Claude API with:', claudePayload);
      
      // In production, this would be:
      // const response = await fetch('https://api.anthropic.com/v1/messages', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'x-api-key': process.env.CLAUDE_API_KEY,
      //     'anthropic-version': '2023-06-01'
      //   },
      //   body: JSON.stringify(claudePayload)
      // });
      
      throw new Error('Real Claude integration not yet implemented - use mock mode');
      
    } catch (error) {
      console.error('❌ Claude API error:', error.message);
      
      // Return degraded response
      return {
        status: 'error',
        error: error.message,
        fallback: 'Use Context-OS only mode',
        requestId: `error-${Date.now()}`
      };
    }
  }
  
  /**
   * Invoke WebSearch tool
   */
  async invokeWebSearch(query) {
    if (this.mode === 'mock') {
      await this.simulateDelay(200, 800);
      
      return {
        status: 'ok',
        results: [
          {
            title: `Best practices for ${query}`,
            url: 'https://example.com/best-practices',
            snippet: 'Mock search result snippet...'
          },
          {
            title: `Common issues with ${query}`,
            url: 'https://example.com/issues',
            snippet: 'Mock issue description...'
          }
        ],
        metadata: {
          tokensUsed: 300,
          duration: 500
        }
      };
    }
    
    // Real implementation would call Claude's WebSearch
    throw new Error('WebSearch not implemented - use mock mode');
  }
  
  /**
   * Invoke WebFetch tool
   */
  async invokeWebFetch(url, prompt) {
    if (this.mode === 'mock') {
      await this.simulateDelay(300, 1000);
      
      return {
        status: 'ok',
        content: `Mock content from ${url}`,
        analysis: `Mock analysis based on prompt: ${prompt}`,
        metadata: {
          tokensUsed: 800,
          duration: 750
        }
      };
    }
    
    throw new Error('WebFetch not implemented - use mock mode');
  }
  
  /**
   * Parallel execution helper
   */
  async invokeParallel(requests, maxConcurrency = 2) {
    const results = [];
    const executing = [];
    
    for (const request of requests) {
      const promise = this.invokeTask(request).then(result => ({
        request,
        result
      }));
      
      if (requests.length <= maxConcurrency) {
        results.push(await promise);
      } else {
        executing.push(promise);
        
        if (executing.length >= maxConcurrency) {
          results.push(await Promise.race(executing));
          executing.splice(executing.findIndex(p => p === promise), 1);
        }
      }
    }
    
    // Wait for remaining
    results.push(...await Promise.all(executing));
    
    return results;
  }
  
  /**
   * Simulate network delay for realistic testing
   */
  simulateDelay(min, max) {
    const delay = Math.random() * (max - min) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }
  
  /**
   * Get current usage stats
   */
  getUsageStats() {
    return {
      mode: this.mode,
      callCount: this.callCount,
      totalTokens: this.costTracker.totalTokens,
      estimatedCost: this.costTracker.totalCost,
      averageTokensPerCall: this.callCount > 0 
        ? Math.round(this.costTracker.totalTokens / this.callCount)
        : 0
    };
  }
  
  /**
   * Reset usage stats
   */
  resetStats() {
    this.callCount = 0;
    this.costTracker.totalTokens = 0;
    this.costTracker.totalCost = 0;
  }
  
  /**
   * Switch between mock and real mode
   */
  setMode(mode) {
    if (!['mock', 'real'].includes(mode)) {
      throw new Error('Invalid mode. Use "mock" or "real"');
    }
    this.mode = mode;
    console.log(`🔄 Claude adapter switched to ${mode} mode`);
  }
}

module.exports = { ClaudeAdapter };