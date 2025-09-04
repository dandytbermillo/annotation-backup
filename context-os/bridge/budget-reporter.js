/**
 * Budget Reporter Module
 * Tracks and visualizes token usage and costs
 */

const fs = require('fs');
const path = require('path');

class BudgetReporter {
  constructor(options = {}) {
    this.budgetPath = options.budgetPath || 'context-os/telemetry/budget.json';
    this.maxDailyTokens = options.maxDailyTokens || 100000;
    this.maxMonthlySpend = options.maxMonthlySpend || 50.00;
    this.tokenPricing = {
      input: 0.000015,   // Per token
      output: 0.00006,   // Per token
      cached: 0.0000075  // Cached input tokens
    };
    
    this.loadBudgetData();
  }
  
  /**
   * Load or initialize budget data
   */
  loadBudgetData() {
    try {
      if (fs.existsSync(this.budgetPath)) {
        this.data = JSON.parse(fs.readFileSync(this.budgetPath, 'utf8'));
      } else {
        this.data = this.initializeBudgetData();
      }
    } catch (error) {
      console.warn('Could not load budget data:', error);
      this.data = this.initializeBudgetData();
    }
  }
  
  /**
   * Initialize empty budget data
   */
  initializeBudgetData() {
    return {
      daily: {},
      monthly: {},
      lifetime: {
        totalTokens: 0,
        totalCost: 0,
        startDate: new Date().toISOString()
      }
    };
  }
  
  /**
   * Track token usage
   */
  trackUsage(usage) {
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0, 7);
    
    // Initialize daily entry if needed
    if (!this.data.daily[today]) {
      this.data.daily[today] = {
        tokens: { input: 0, output: 0, cached: 0 },
        cost: 0,
        commands: 0,
        savings: 0
      };
    }
    
    // Initialize monthly entry if needed
    if (!this.data.monthly[month]) {
      this.data.monthly[month] = {
        tokens: { input: 0, output: 0, cached: 0 },
        cost: 0,
        commands: 0,
        savings: 0
      };
    }
    
    // Update daily
    const daily = this.data.daily[today];
    daily.tokens.input += usage.inputTokens || 0;
    daily.tokens.output += usage.outputTokens || 0;
    daily.tokens.cached += usage.cachedTokens || 0;
    daily.commands += 1;
    daily.cost += this.calculateCost(usage);
    daily.savings += usage.tokensSaved || 0;
    
    // Update monthly
    const monthly = this.data.monthly[month];
    monthly.tokens.input += usage.inputTokens || 0;
    monthly.tokens.output += usage.outputTokens || 0;
    monthly.tokens.cached += usage.cachedTokens || 0;
    monthly.commands += 1;
    monthly.cost += this.calculateCost(usage);
    monthly.savings += usage.tokensSaved || 0;
    
    // Update lifetime
    this.data.lifetime.totalTokens += (usage.inputTokens || 0) + (usage.outputTokens || 0);
    this.data.lifetime.totalCost += this.calculateCost(usage);
    
    // Save
    this.saveBudgetData();
  }
  
  /**
   * Calculate cost for usage
   */
  calculateCost(usage) {
    let cost = 0;
    cost += (usage.inputTokens || 0) * this.tokenPricing.input;
    cost += (usage.outputTokens || 0) * this.tokenPricing.output;
    cost += (usage.cachedTokens || 0) * this.tokenPricing.cached;
    return cost;
  }
  
  /**
   * Save budget data
   */
  saveBudgetData() {
    try {
      const dir = path.dirname(this.budgetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.budgetPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.warn('Could not save budget data:', error);
    }
  }
  
  /**
   * Generate CLI budget report
   */
  generateReport(format = 'simple') {
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0, 7);
    
    const daily = this.data.daily[today] || this.initializeDayData();
    const monthly = this.data.monthly[month] || this.initializeMonthData();
    
    if (format === 'simple') {
      return this.generateSimpleReport(daily, monthly);
    } else if (format === 'detailed') {
      return this.generateDetailedReport(daily, monthly);
    } else if (format === 'visual') {
      return this.generateVisualReport(daily, monthly);
    }
  }
  
  /**
   * Simple text report
   */
  generateSimpleReport(daily, monthly) {
    const dailyPercent = (daily.tokens.input + daily.tokens.output) / this.maxDailyTokens * 100;
    const monthlyPercent = monthly.cost / this.maxMonthlySpend * 100;
    
    return `
📊 Token Budget Report
─────────────────────
Today: ${(daily.tokens.input + daily.tokens.output).toLocaleString()} tokens ($${daily.cost.toFixed(4)})
Month: $${monthly.cost.toFixed(2)} / $${this.maxMonthlySpend.toFixed(2)} (${monthlyPercent.toFixed(1)}%)
Saved: ${daily.savings.toLocaleString()} tokens today
`.trim();
  }
  
  /**
   * Detailed report with breakdown
   */
  generateDetailedReport(daily, monthly) {
    return `
📊 Detailed Budget Report
═══════════════════════════

📅 TODAY (${new Date().toISOString().split('T')[0]})
─────────────────────────
Input Tokens:    ${daily.tokens.input.toLocaleString().padStart(10)}
Output Tokens:   ${daily.tokens.output.toLocaleString().padStart(10)}
Cached Tokens:   ${daily.tokens.cached.toLocaleString().padStart(10)}
Commands Run:    ${daily.commands.toString().padStart(10)}
Cost:           $${daily.cost.toFixed(4).padStart(10)}
Tokens Saved:    ${daily.savings.toLocaleString().padStart(10)}

📆 THIS MONTH
─────────────────────────
Total Tokens:    ${(monthly.tokens.input + monthly.tokens.output).toLocaleString().padStart(10)}
Total Commands:  ${monthly.commands.toString().padStart(10)}
Total Cost:     $${monthly.cost.toFixed(2).padStart(10)}
Budget Used:     ${(monthly.cost / this.maxMonthlySpend * 100).toFixed(1)}%
Remaining:      $${(this.maxMonthlySpend - monthly.cost).toFixed(2).padStart(10)}

💰 LIFETIME STATS
─────────────────────────
Total Tokens:    ${this.data.lifetime.totalTokens.toLocaleString()}
Total Cost:     $${this.data.lifetime.totalCost.toFixed(2)}
Active Since:    ${this.data.lifetime.startDate.split('T')[0]}
`.trim();
  }
  
  /**
   * Visual bar chart report
   */
  generateVisualReport(daily, monthly) {
    const dailyPercent = Math.min((daily.tokens.input + daily.tokens.output) / this.maxDailyTokens * 100, 100);
    const monthlyPercent = Math.min(monthly.cost / this.maxMonthlySpend * 100, 100);
    
    const createBar = (percent, width = 20) => {
      const filled = Math.round(percent / 100 * width);
      const empty = width - filled;
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
      
      // Color based on usage
      if (percent > 80) return `\x1b[31m${bar}\x1b[0m`; // Red
      if (percent > 60) return `\x1b[33m${bar}\x1b[0m`; // Yellow
      return `\x1b[32m${bar}\x1b[0m`; // Green
    };
    
    return `
💰 Token Budget Status
══════════════════════════════

Daily Tokens  [${createBar(dailyPercent)}] ${dailyPercent.toFixed(1)}%
              ${(daily.tokens.input + daily.tokens.output).toLocaleString()} / ${this.maxDailyTokens.toLocaleString()}

Monthly Spend [${createBar(monthlyPercent)}] ${monthlyPercent.toFixed(1)}%
              $${monthly.cost.toFixed(2)} / $${this.maxMonthlySpend.toFixed(2)}

📈 Trend: ${this.calculateTrend()} | 💾 Saved: ${daily.savings.toLocaleString()} tokens today

Commands today: ${daily.commands} | This month: ${monthly.commands}
`.trim();
  }
  
  /**
   * Calculate usage trend
   */
  calculateTrend() {
    const dates = Object.keys(this.data.daily).sort().slice(-7); // Last 7 days
    if (dates.length < 2) return 'Insufficient data';
    
    const usage = dates.map(date => 
      (this.data.daily[date].tokens.input + this.data.daily[date].tokens.output)
    );
    
    const avgRecent = usage.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const avgPrevious = usage.slice(0, -3).reduce((a, b) => a + b, 0) / Math.max(usage.length - 3, 1);
    
    if (avgRecent > avgPrevious * 1.2) return '📈 Increasing';
    if (avgRecent < avgPrevious * 0.8) return '📉 Decreasing';
    return '→ Stable';
  }
  
  /**
   * Initialize empty day data
   */
  initializeDayData() {
    return {
      tokens: { input: 0, output: 0, cached: 0 },
      cost: 0,
      commands: 0,
      savings: 0
    };
  }
  
  /**
   * Initialize empty month data
   */
  initializeMonthData() {
    return {
      tokens: { input: 0, output: 0, cached: 0 },
      cost: 0,
      commands: 0,
      savings: 0
    };
  }
}

module.exports = { BudgetReporter };