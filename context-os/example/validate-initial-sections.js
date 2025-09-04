#!/usr/bin/env node
/**
 * validate-initial-sections.js
 * 
 * Validates INITIAL.md files have required sections as defined in config.json
 * Ensures CI gates can enforce documentation standards
 * 
 * Usage:
 *   node scripts/validate-initial-sections.js --feature <slug> [--json]
 *   node scripts/validate-initial-sections.js --all [--json]
 *   node scripts/validate-initial-sections.js --feature <slug> --root /path/to/repo
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
  feature: null,
  all: false,
  json: false,
  root: process.cwd(),
  help: false
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--feature':
      flags.feature = args[++i];
      break;
    case '--all':
      flags.all = true;
      break;
    case '--json':
      flags.json = true;
      break;
    case '--root':
      flags.root = args[++i];
      break;
    case '--help':
    case '-h':
      flags.help = true;
      break;
  }
}

if (flags.help) {
  console.log(`
INITIAL.md Section Validator

Usage:
  node validate-initial-sections.js --feature <slug> [--json]
  node validate-initial-sections.js --all [--json]
  
Options:
  --feature <slug>  Validate specific feature
  --all            Validate all features in docs/proposal/
  --json           Output JSON format
  --root <path>    Repository root (default: current directory)
  --help           Show this help

Examples:
  node validate-initial-sections.js --feature dark_mode
  node validate-initial-sections.js --all --json
  
Exit codes:
  0 - All validations passed
  1 - One or more validations failed
  `);
  process.exit(0);
}

// Load configuration
function loadConfig() {
  const configPath = path.join(flags.root, '.context-os', 'config.json');
  const defaultConfig = {
    validation: {
      requiredSections: ['problem', 'goals', 'acceptanceCriteria', 'stakeholders'],
      minBullets: {
        goals: 3,
        acceptanceCriteria: 3,
        stakeholders: 2
      },
      strictMode: false
    }
  };
  
  try {
    if (fs.existsSync(configPath)) {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...defaultConfig, ...userConfig };
    }
  } catch (e) {
    if (!flags.json) {
      console.error(`Warning: Could not load config from ${configPath}`);
    }
  }
  
  return defaultConfig;
}

// Parse INITIAL.md content
function parseInitialMd(content) {
  const sections = {};
  const lines = content.split('\n');
  
  let currentSection = null;
  let sectionContent = [];
  
  for (const line of lines) {
    // Check for section headers
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      // Save previous section
      if (currentSection) {
        sections[currentSection] = sectionContent.join('\n').trim();
      }
      
      // Start new section
      currentSection = sectionMatch[1].toLowerCase().replace(/\s+/g, '');
      // Handle variations
      if (currentSection === 'acceptancecriteria' || currentSection === 'acceptance-criteria') {
        currentSection = 'acceptanceCriteria';
      }
      if (currentSection === 'successmetrics' || currentSection === 'metrics') {
        currentSection = 'metrics';
      }
      if (currentSection === 'non-goals' || currentSection === 'nongoals') {
        currentSection = 'nonGoals';
      }
      
      sectionContent = [];
    } else if (currentSection) {
      sectionContent.push(line);
    }
  }
  
  // Save last section
  if (currentSection) {
    sections[currentSection] = sectionContent.join('\n').trim();
  }
  
  return sections;
}

// Count bullet points in a section
function countBullets(content) {
  if (!content) return 0;
  
  const bullets = content.split('\n').filter(line => {
    return line.match(/^\s*[-*]\s+.+/);
  });
  
  return bullets.length;
}

// Validate a single INITIAL.md file
function validateInitial(featureSlug, config) {
  const initialPath = path.join(flags.root, 'docs', 'proposal', featureSlug, 'INITIAL.md');
  
  const result = {
    feature: featureSlug,
    file: initialPath,
    exists: false,
    status: 'pass',
    missing: [],
    empty: [],
    counts: {}
  };
  
  // Check if file exists
  if (!fs.existsSync(initialPath)) {
    result.status = 'fail';
    result.missing = ['FILE_NOT_FOUND'];
    return result;
  }
  
  result.exists = true;
  
  // Read and parse file
  const content = fs.readFileSync(initialPath, 'utf8');
  const sections = parseInitialMd(content);
  
  // Check required sections
  const requiredSections = config.validation.requiredSections || [];
  const minBullets = config.validation.minBullets || {};
  
  for (const section of requiredSections) {
    const sectionKey = section.toLowerCase().replace(/\s+/g, '');
    
    if (!sections[sectionKey]) {
      result.missing.push(section);
      result.status = 'fail';
    } else if (!sections[sectionKey].trim()) {
      result.empty.push(section);
      result.status = 'fail';
    } else {
      // Check minimum bullet counts if applicable
      if (minBullets[section]) {
        const bulletCount = countBullets(sections[sectionKey]);
        result.counts[section] = bulletCount;
        
        if (bulletCount < minBullets[section]) {
          result.empty.push(`${section}:minBullets<${minBullets[section]}`);
          result.status = 'fail';
        }
      }
    }
  }
  
  return result;
}

// Get all features to validate
function getFeatures() {
  if (flags.feature) {
    return [flags.feature];
  }
  
  if (flags.all) {
    const proposalDir = path.join(flags.root, 'docs', 'proposal');
    
    if (!fs.existsSync(proposalDir)) {
      return [];
    }
    
    return fs.readdirSync(proposalDir).filter(name => {
      const stat = fs.statSync(path.join(proposalDir, name));
      return stat.isDirectory();
    });
  }
  
  return [];
}

// Main validation
function main() {
  const config = loadConfig();
  const features = getFeatures();
  
  if (features.length === 0) {
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, results: [], message: 'No features to validate' }));
    } else {
      console.log('No features to validate. Use --feature <slug> or --all');
    }
    process.exit(0);
  }
  
  const results = [];
  let hasFailures = false;
  
  for (const feature of features) {
    const result = validateInitial(feature, config);
    results.push(result);
    
    if (result.status === 'fail') {
      hasFailures = true;
    }
  }
  
  // Output results
  if (flags.json) {
    console.log(JSON.stringify({
      ok: !hasFailures,
      results
    }, null, 2));
  } else {
    // Human-readable output
    console.log('INITIAL.md Validation Report');
    console.log('=' .repeat(50));
    
    for (const result of results) {
      const icon = result.status === 'pass' ? '✅' : '❌';
      console.log(`\n${icon} ${result.feature}`);
      
      if (!result.exists) {
        console.log('   ⚠️  INITIAL.md not found');
      } else {
        if (result.missing.length > 0) {
          console.log(`   Missing sections: ${result.missing.join(', ')}`);
        }
        if (result.empty.length > 0) {
          console.log(`   Empty/insufficient: ${result.empty.join(', ')}`);
        }
        if (Object.keys(result.counts).length > 0) {
          console.log(`   Bullet counts: ${JSON.stringify(result.counts)}`);
        }
      }
    }
    
    console.log('\n' + '=' .repeat(50));
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    console.log(`Summary: ${passed} passed, ${failed} failed`);
  }
  
  process.exit(hasFailures ? 1 : 0);
}

// Run validation
main();