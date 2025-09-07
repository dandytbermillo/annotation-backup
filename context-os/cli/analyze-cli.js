#!/usr/bin/env node

/**
 * Analyze CLI - Feature analysis using Claude's intelligence (mocked)
 * Part of Context-OS command system
 */

const fs = require('fs');
const path = require('path');

class AnalyzeCLI {
  constructor() {
    this.basePath = path.join(__dirname, '../../docs/proposal');
  }

  /**
   * Analyze a specific feature
   */
  analyzeFeature(featureSlug, options = {}) {
    const featurePath = path.join(this.basePath, featureSlug);
    
    if (!fs.existsSync(featurePath)) {
      return {
        ok: false,
        error: `Feature '${featureSlug}' not found`,
        suggestion: 'Run with --all to analyze all features'
      };
    }

    // Simulate Claude analysis (in production, would call Claude API)
    const analysis = this.performAnalysis(featurePath, options);
    
    return {
      ok: true,
      feature: featureSlug,
      analysis,
      metrics: options.metrics ? this.getMetrics(featurePath) : undefined
    };
  }

  /**
   * Perform deep analysis (mocked for now)
   */
  performAnalysis(featurePath, options) {
    const implPath = path.join(featurePath, 'implementation.md');
    const fixesPath = path.join(featurePath, 'post-implementation-fixes');
    
    // Calculate complexity based on file structure
    let complexity = 'LOW';
    let risk = 'LOW';
    let health = 100;
    let coverage = 0;
    
    if (fs.existsSync(implPath)) {
      const content = fs.readFileSync(implPath, 'utf8');
      const lines = content.split('\n').length;
      
      // Simple heuristics
      if (lines > 500) complexity = 'HIGH';
      else if (lines > 200) complexity = 'MEDIUM';
      
      // Check for test mentions
      const hasTests = content.toLowerCase().includes('test');
      coverage = hasTests ? 75 : 0;
      
      // Check for TODO items
      const todos = (content.match(/TODO|FIXME/gi) || []).length;
      if (todos > 5) risk = 'HIGH';
      else if (todos > 2) risk = 'MEDIUM';
      
      health = Math.max(0, 100 - (todos * 10));
    }
    
    // Count fixes as risk indicators
    if (fs.existsSync(fixesPath)) {
      const criticalPath = path.join(fixesPath, 'critical');
      const highPath = path.join(fixesPath, 'high');
      
      if (fs.existsSync(criticalPath) && fs.readdirSync(criticalPath).length > 0) {
        risk = 'HIGH';
        health -= 20;
      } else if (fs.existsSync(highPath) && fs.readdirSync(highPath).length > 0) {
        risk = 'MEDIUM';
        health -= 10;
      }
    }
    
    // Generate recommendations based on analysis
    const recommendations = [];
    
    if (coverage < 50) {
      recommendations.push('Increase test coverage to at least 80%');
    }
    if (complexity === 'HIGH') {
      recommendations.push('Consider breaking down into smaller modules');
    }
    if (risk === 'HIGH') {
      recommendations.push('Address critical issues before deployment');
    }
    if (!fs.existsSync(path.join(featurePath, 'architecture.md'))) {
      recommendations.push('Add architecture documentation');
    }
    
    return {
      complexity,
      risk,
      health: Math.max(0, health),
      coverage,
      recommendations
    };
  }

  /**
   * Get metrics for a feature
   */
  getMetrics(featurePath) {
    const metrics = {
      loc: 0,
      files: 0,
      dependencies: 0,
      integrationPoints: 0
    };
    
    // Count files
    const countFiles = (dir) => {
      if (!fs.existsSync(dir)) return;
      
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !item.startsWith('.')) {
          countFiles(fullPath);
        } else if (stat.isFile() && item.endsWith('.md')) {
          metrics.files++;
          const content = fs.readFileSync(fullPath, 'utf8');
          metrics.loc += content.split('\n').length;
          
          // Count dependencies (simple heuristic)
          const imports = (content.match(/import|require/gi) || []).length;
          metrics.dependencies += imports;
          
          // Count integration points
          const apis = (content.match(/API|endpoint|route/gi) || []).length;
          metrics.integrationPoints += apis;
        }
      }
    };
    
    countFiles(featurePath);
    
    return metrics;
  }

  /**
   * Analyze all features
   */
  analyzeAll() {
    if (!fs.existsSync(this.basePath)) {
      return {
        ok: false,
        error: 'No features found',
        suggestion: 'Create features first with /context-execute'
      };
    }

    const features = fs.readdirSync(this.basePath)
      .filter(dir => {
        const fullPath = path.join(this.basePath, dir);
        return fs.statSync(fullPath).isDirectory() && !dir.startsWith('.');
      });

    const analyses = [];
    let totalHealth = 0;
    
    for (const feature of features) {
      const result = this.analyzeFeature(feature, { metrics: true });
      if (result.ok) {
        analyses.push({
          name: feature,
          ...result.analysis,
          metrics: result.metrics
        });
        totalHealth += result.analysis.health;
      }
    }

    return {
      ok: true,
      features: analyses,
      overallHealth: features.length > 0 ? Math.round(totalHealth / features.length) : 0,
      summary: {
        total: features.length,
        highRisk: analyses.filter(a => a.risk === 'HIGH').length,
        mediumRisk: analyses.filter(a => a.risk === 'MEDIUM').length,
        lowRisk: analyses.filter(a => a.risk === 'LOW').length
      }
    };
  }

  /**
   * System health analysis
   */
  analyzeHealth() {
    const all = this.analyzeAll();
    
    if (!all.ok) return all;
    
    const indicators = {
      positive: [],
      concerns: [],
      trends: {}
    };
    
    // Positive indicators
    if (all.overallHealth >= 80) {
      indicators.positive.push('Overall system health is good');
    }
    if (all.summary.highRisk === 0) {
      indicators.positive.push('No high-risk features detected');
    }
    
    // Concerns
    if (all.summary.highRisk > 2) {
      indicators.concerns.push(`${all.summary.highRisk} high-risk features need attention`);
    }
    
    const avgCoverage = all.features.reduce((sum, f) => sum + f.coverage, 0) / all.features.length;
    if (avgCoverage < 60) {
      indicators.concerns.push(`Test coverage below 60% (${Math.round(avgCoverage)}%)`);
    }
    
    // Trends (mocked for now)
    indicators.trends = {
      velocity: '2.3 features/month',
      bugRate: '0.8/feature',
      fixTime: '3.2 days average'
    };
    
    return {
      ok: true,
      health: all.overallHealth,
      indicators,
      features: all.summary,
      recommendations: this.generateSystemRecommendations(all)
    };
  }

  /**
   * Generate system-wide recommendations
   */
  generateSystemRecommendations(analysis) {
    const recommendations = {
      immediate: [],
      shortTerm: [],
      longTerm: []
    };
    
    // Immediate actions
    if (analysis.summary.highRisk > 0) {
      recommendations.immediate.push({
        action: 'Fix high-risk features',
        features: analysis.features.filter(f => f.risk === 'HIGH').map(f => f.name),
        estimated: '1-2 days'
      });
    }
    
    // Short-term improvements
    const lowCoverage = analysis.features.filter(f => f.coverage < 50);
    if (lowCoverage.length > 0) {
      recommendations.shortTerm.push({
        action: 'Improve test coverage',
        target: '85% minimum',
        features: lowCoverage.map(f => f.name)
      });
    }
    
    // Long-term strategy
    if (analysis.features.length > 10) {
      recommendations.longTerm.push({
        action: 'Implement feature categorization',
        reason: 'Better organization for large codebase'
      });
    }
    
    return recommendations;
  }

  /**
   * Format output for display
   */
  formatOutput(result) {
    if (!result.ok) {
      console.log(`❌ Error: ${result.error}`);
      if (result.suggestion) {
        console.log(`💡 ${result.suggestion}`);
      }
      return;
    }

    // Single feature analysis
    if (result.feature) {
      console.log(`🔍 Analyzing: ${result.feature}\n`);
      
      console.log('## Complexity Analysis');
      console.log(`- Code Complexity: ${result.analysis.complexity}`);
      console.log(`- Risk Level: ${result.analysis.risk}`);
      console.log(`- Health Score: ${result.analysis.health}%`);
      console.log(`- Test Coverage: ${result.analysis.coverage}%`);
      
      if (result.metrics) {
        console.log('\n## Metrics');
        console.log(`- Lines of Code: ${result.metrics.loc}`);
        console.log(`- Files: ${result.metrics.files}`);
        console.log(`- Dependencies: ${result.metrics.dependencies}`);
        console.log(`- Integration Points: ${result.metrics.integrationPoints}`);
      }
      
      if (result.analysis.recommendations.length > 0) {
        console.log('\n## Recommendations');
        result.analysis.recommendations.forEach((rec, i) => {
          console.log(`${i + 1}. ${rec}`);
        });
      }
    }
    // Health analysis
    else if (result.indicators) {
      console.log('🏥 Context-OS Health Analysis\n');
      console.log(`## Overall Health: ${result.health}% ${result.health >= 80 ? '🟢' : result.health >= 60 ? '🟡' : '🔴'}\n`);
      
      if (result.indicators.positive.length > 0) {
        console.log('### Positive Indicators');
        result.indicators.positive.forEach(item => {
          console.log(`✅ ${item}`);
        });
        console.log('');
      }
      
      if (result.indicators.concerns.length > 0) {
        console.log('### Areas of Concern');
        result.indicators.concerns.forEach(item => {
          console.log(`⚠️  ${item}`);
        });
        console.log('');
      }
      
      if (result.indicators.trends) {
        console.log('### Trend Analysis');
        Object.entries(result.indicators.trends).forEach(([key, value]) => {
          const icon = key === 'velocity' ? '📈' : key === 'bugRate' ? '📉' : '➡️';
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
          console.log(`${icon} ${label}: ${value}`);
        });
        console.log('');
      }
      
      if (result.recommendations) {
        console.log('### Recommendations');
        if (result.recommendations.immediate.length > 0) {
          console.log('\n**Immediate Actions:**');
          result.recommendations.immediate.forEach(rec => {
            console.log(`- ${rec.action} (${rec.estimated || 'TBD'})`);
          });
        }
        if (result.recommendations.shortTerm.length > 0) {
          console.log('\n**Short-term Improvements:**');
          result.recommendations.shortTerm.forEach(rec => {
            console.log(`- ${rec.action}`);
          });
        }
        if (result.recommendations.longTerm.length > 0) {
          console.log('\n**Long-term Strategy:**');
          result.recommendations.longTerm.forEach(rec => {
            console.log(`- ${rec.action}`);
          });
        }
      }
    }
    // All features analysis
    else if (result.features) {
      console.log('📊 All Features Analysis\n');
      console.log(`Overall Health: ${result.overallHealth}%\n`);
      
      console.log('## Risk Distribution');
      console.log(`🔴 High Risk: ${result.summary.highRisk} features`);
      console.log(`🟡 Medium Risk: ${result.summary.mediumRisk} features`);
      console.log(`🟢 Low Risk: ${result.summary.lowRisk} features`);
      console.log('');
      
      console.log('## Feature Details');
      result.features.forEach(f => {
        const riskIcon = f.risk === 'HIGH' ? '🔴' : f.risk === 'MEDIUM' ? '🟡' : '🟢';
        console.log(`${riskIcon} ${f.name}: Health ${f.health}%, Coverage ${f.coverage}%`);
      });
    }
  }

  /**
   * Main execution
   */
  run(args) {
    const command = args[0];
    
    let result;
    
    if (!command || command === '--help') {
      console.log('Usage: analyze-cli <feature> [options]');
      console.log('       analyze-cli --all');
      console.log('       analyze-cli --health');
      console.log('\nOptions:');
      console.log('  --metrics    Include performance metrics');
      console.log('  --all        Analyze all features');
      console.log('  --health     System health analysis');
      return { ok: true };
    }
    
    switch (command) {
      case '--all':
        result = this.analyzeAll();
        break;
        
      case '--health':
        result = this.analyzeHealth();
        break;
        
      default:
        // Analyze specific feature
        const includeMetrics = args.includes('--metrics');
        result = this.analyzeFeature(command, { metrics: includeMetrics });
    }
    
    // JSON mode for programmatic use
    if (process.env.JSON_OUTPUT === 'true') {
      console.log(JSON.stringify(result));
    } else {
      this.formatOutput(result);
    }
    
    return result;
  }
}

// CLI interface
if (require.main === module) {
  const cli = new AnalyzeCLI();
  const args = process.argv.slice(2);
  const result = cli.run(args);
  
  // Exit with appropriate code
  process.exit(result.ok ? 0 : 1);
}

module.exports = AnalyzeCLI;