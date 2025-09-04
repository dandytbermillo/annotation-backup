#!/usr/bin/env node

/**
 * Feature Display v2.0
 * Reads features JSON and displays formatted output
 * Supports multiple output formats via --format flag
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    format: 'table',
    feature: null,
    jsonPath: path.join(__dirname, '..', 'var', 'features.json'),
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' && args[i + 1]) {
      options.format = args[++i];
    } else if (args[i] === '--feature' && args[i + 1]) {
      options.feature = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      options.help = true;
    } else if (args[i].endsWith('.json')) {
      options.jsonPath = args[i];
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`Feature Display v2.0

Usage: node show-features.js [options]

Options:
  --format <type>    Output format: table, detailed, summary, json (default: table)
  --feature <slug>   Show details for specific feature
  --help, -h         Show this help message

Examples:
  node show-features.js                         # Show table view
  node show-features.js --format detailed       # Show detailed view
  node show-features.js --feature add_dark_mode # Show specific feature
  node show-features.js --format json           # Output raw JSON
`);
}

function showFeatures(options) {
  // Check if file exists
  if (!fs.existsSync(options.jsonPath)) {
    console.error(`❌ Features data not found at ${options.jsonPath}`);
    console.error('Run "npm run context:scan" first to generate features data');
    process.exit(1);
  }
  
  // Read and parse JSON
  const data = JSON.parse(fs.readFileSync(options.jsonPath, 'utf8'));
  
  // Check schema version compatibility
  if (data.schemaVersion && data.schemaVersion.split('.')[0] !== '2') {
    console.error(`⚠️  Warning: Schema version ${data.schemaVersion} may not be fully compatible`);
  }
  
  // Filter to specific feature if requested
  if (options.feature) {
    const feature = data.features.find(f => f.slug === options.feature);
    if (!feature) {
      console.error(`❌ Feature "${options.feature}" not found`);
      process.exit(1);
    }
    showFeatureDetail(feature, data);
    return;
  }
  
  // Display based on format
  switch (options.format) {
    case 'table':
      showTable(data);
      break;
    case 'detailed':
      showDetailed(data);
      break;
    case 'summary':
      showSummary(data);
      break;
    case 'json':
      console.log(JSON.stringify(data, null, 2));
      break;
    default:
      console.error(`❌ Unknown format: ${options.format}`);
      console.error('Valid formats: table, detailed, summary, json');
      process.exit(1);
  }
}

function showTable(data) {
  console.log('📋 Feature Status Overview');
  console.log('─────────────────────────────────────────────────────────────');
  
  if (data.features.length === 0) {
    console.log('No features found in docs/proposal/');
    return;
  }
  
  // Calculate column widths
  const maxSlugLen = Math.max(20, ...data.features.map(f => f.slug.length));
  
  // Header
  console.log(`${'Feature'.padEnd(maxSlugLen)} │ Status           │ 📊 │ 🔧 │ ⚠️  │ Modified`);
  console.log(`${'─'.repeat(maxSlugLen)}─┼──────────────────┼────┼────┼────┼──────────`);
  
  // Rows
  for (const feature of data.features) {
    const slug = feature.slug.padEnd(maxSlugLen);
    const status = feature.status.padEnd(17);
    const files = String(feature.fileCount || 0).padStart(2);
    const fixes = String(feature.fixCount || 0).padStart(2);
    const issues = String(feature.validationIssues?.length || 0).padStart(2);
    const modified = feature.lastModified || 'Unknown   ';
    
    console.log(`${slug} │ ${status} │ ${files} │ ${fixes} │ ${issues} │ ${modified}`);
  }
  
  // Footer
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`Total: ${data.totalFeatures} features`);
  
  if (data.byStatus) {
    const stats = [];
    if (data.byStatus.inProgress > 0) stats.push(`🚧 ${data.byStatus.inProgress}`);
    if (data.byStatus.blocked > 0) stats.push(`❌ ${data.byStatus.blocked}`);
    if (data.byStatus.planned > 0) stats.push(`📝 ${data.byStatus.planned}`);
    if (data.byStatus.complete > 0) stats.push(`✅ ${data.byStatus.complete}`);
    if (data.byStatus.unknown > 0) stats.push(`❓ ${data.byStatus.unknown}`);
    
    if (stats.length > 0) {
      console.log(`Status: ${stats.join(' │ ')}`);
    }
  }
  
  if (data.validationSummary) {
    console.log(`\nValidation: ${data.validationSummary.featuresWithIssues} features with ${data.validationSummary.totalIssues} issues`);
  }
  
  console.log(`\n${data.schemaVersion ? `Schema: v${data.schemaVersion} │ ` : ''}Generated: ${new Date(data.generatedAt).toLocaleString()}`);
}

function showDetailed(data) {
  console.log('📋 Feature Details');
  console.log('═════════════════════════════════════════════════════════════\n');
  
  for (const feature of data.features) {
    console.log(`📁 ${feature.slug}`);
    console.log(`   Status: ${feature.status}`);
    console.log(`   Files: ${feature.fileCount || 0}`);
    if (feature.fixCount > 0) {
      console.log(`   Fixes: ${feature.fixCount}`);
    }
    console.log(`   Modified: ${feature.lastModified || 'Unknown'}`);
    console.log(`   Path: ${feature.path}`);
    
    if (feature.hasReport !== undefined) {
      console.log(`   Has Report: ${feature.hasReport ? '✅' : '❌'}`);
    }
    
    if (feature.validationIssues?.length > 0) {
      console.log(`   ⚠️  Issues:`);
      for (const issue of feature.validationIssues) {
        console.log(`      - ${issue}`);
      }
    }
    
    if (feature.nextActions) {
      console.log(`   ➡️  Next: ${feature.nextActions}`);
    }
    
    console.log();
  }
  
  if (data.errors?.length > 0) {
    console.log('⚠️  Scan Errors:');
    for (const error of data.errors) {
      console.log(`   ${error.slug}: ${error.error}`);
    }
    console.log();
  }
  
  console.log(`${data.schemaVersion ? `Schema: v${data.schemaVersion}\n` : ''}Generated: ${new Date(data.generatedAt).toLocaleString()}`);
}

function showSummary(data) {
  console.log('📊 Features Summary');
  console.log('═══════════════════════════════');
  
  console.log(`\nTotal Features: ${data.totalFeatures}`);
  console.log();
  
  console.log('Status Breakdown:');
  if (data.byStatus.inProgress > 0) {
    console.log(`  🚧 In Progress: ${data.byStatus.inProgress}`);
  }
  if (data.byStatus.blocked > 0) {
    console.log(`  ❌ Blocked:     ${data.byStatus.blocked}`);
  }
  if (data.byStatus.planned > 0) {
    console.log(`  📝 Planned:     ${data.byStatus.planned}`);
  }
  if (data.byStatus.complete > 0) {
    console.log(`  ✅ Complete:    ${data.byStatus.complete}`);
  }
  if (data.byStatus.unknown > 0) {
    console.log(`  ❓ Unknown:     ${data.byStatus.unknown}`);
  }
  
  if (data.validationSummary) {
    console.log(`\nValidation Status:`);
    console.log(`  Features with issues: ${data.validationSummary.featuresWithIssues}`);
    console.log(`  Total issues: ${data.validationSummary.totalIssues}`);
  }
  
  // Show features needing attention
  const needsAttention = data.features.filter(f => 
    f.status === '❌ BLOCKED' || 
    f.status === '❓ UNKNOWN' ||
    (f.validationIssues?.length || 0) > 0
  );
  
  if (needsAttention.length > 0) {
    console.log('\n⚠️  Needs Attention:');
    for (const feature of needsAttention) {
      console.log(`  • ${feature.slug} (${feature.status})`);
      if (feature.nextActions) {
        console.log(`    → ${feature.nextActions}`);
      }
    }
  }
  
  console.log(`\n${data.schemaVersion ? `Schema: v${data.schemaVersion} │ ` : ''}Generated: ${new Date(data.generatedAt).toLocaleString()}`);
}

function showFeatureDetail(feature, data) {
  console.log(`📁 Feature: ${feature.slug}`);
  console.log('═════════════════════════════════════════════════════════════\n');
  
  console.log('Status Information:');
  console.log(`  Status: ${feature.status}`);
  console.log(`  Path: ${feature.path}`);
  console.log(`  Last Modified: ${feature.lastModified || 'Unknown'}`);
  
  console.log('\nMetrics:');
  console.log(`  Total Files: ${feature.fileCount || 0}`);
  console.log(`  Post-Implementation Fixes: ${feature.fixCount || 0}`);
  console.log(`  Has Implementation Report: ${feature.hasReport ? '✅ Yes' : '❌ No'}`);
  
  if (feature.validationIssues?.length > 0) {
    console.log('\n⚠️  Validation Issues:');
    for (const issue of feature.validationIssues) {
      console.log(`  • ${issue}`);
    }
  } else {
    console.log('\n✅ No validation issues detected');
  }
  
  if (feature.nextActions) {
    console.log('\n➡️  Suggested Next Action:');
    console.log(`  ${feature.nextActions}`);
  }
  
  if (feature.error) {
    console.log('\n❌ Scan Error:');
    console.log(`  ${feature.error}`);
  }
  
  console.log(`\n${data.schemaVersion ? `Schema: v${data.schemaVersion} │ ` : ''}Generated: ${new Date(data.generatedAt).toLocaleString()}`);
}

// Main execution
const options = parseArgs();

if (options.help) {
  showHelp();
  process.exit(0);
}

try {
  showFeatures(options);
} catch (error) {
  console.error(`Display error: ${error.message}`);
  process.exit(1);
}