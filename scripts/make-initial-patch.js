#!/usr/bin/env node
/**
 * make-initial-patch.js
 * 
 * Generates INITIAL.md.patch files for CI artifacts and review
 * Implements patch-first workflow for documentation changes
 * 
 * Usage:
 *   node scripts/make-initial-patch.js --feature <slug> --proposed <file>
 *   cat proposed.md | node scripts/make-initial-patch.js --feature <slug>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
  feature: null,
  proposed: null,
  stdin: false,
  json: false,
  root: process.cwd(),
  help: false
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--feature':
      flags.feature = args[++i];
      break;
    case '--proposed':
      flags.proposed = args[++i];
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

// Check if input is from stdin
if (!flags.proposed && !process.stdin.isTTY) {
  flags.stdin = true;
}

if (flags.help || !flags.feature) {
  console.log(`
INITIAL.md Patch Generator

Usage:
  node make-initial-patch.js --feature <slug> --proposed <file>
  cat proposed.md | node make-initial-patch.js --feature <slug>
  
Options:
  --feature <slug>   Feature slug (required)
  --proposed <file>  Proposed INITIAL.md file path
  --json            Output JSON format
  --root <path>     Repository root (default: current directory)
  --help            Show this help

Examples:
  node make-initial-patch.js --feature dark_mode --proposed .tmp/initial/dark_mode.md
  cat new-initial.md | node make-initial-patch.js --feature auth_system
  
Output:
  Creates: docs/proposal/<feature>/INITIAL.md.patch
  Returns: JSON with patch statistics
  `);
  process.exit(0);
}

// Read proposed content
async function getProposedContent() {
  if (flags.proposed) {
    // Read from file
    const proposedPath = path.resolve(flags.root, flags.proposed);
    if (!fs.existsSync(proposedPath)) {
      throw new Error(`Proposed file not found: ${proposedPath}`);
    }
    return fs.readFileSync(proposedPath, 'utf8');
  }
  
  if (flags.stdin) {
    // Read from stdin
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      
      process.stdin.on('data', chunk => {
        data += chunk;
      });
      
      process.stdin.on('end', () => {
        resolve(data);
      });
      
      process.stdin.on('error', reject);
    });
  }
  
  throw new Error('No proposed content provided. Use --proposed <file> or pipe to stdin');
}

// Generate unified diff using git diff or fallback
function generateDiff(originalPath, proposedContent) {
  const tempFile = path.join('/tmp', `initial-${Date.now()}.md`);
  
  try {
    // Write proposed content to temp file
    fs.writeFileSync(tempFile, proposedContent, 'utf8');
    
    // Try git diff first (produces nicer output)
    try {
      const diff = execSync(
        `git diff --no-index --no-prefix "${originalPath}" "${tempFile}" || true`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      
      // Clean up temp file
      fs.unlinkSync(tempFile);
      
      return diff;
    } catch (gitError) {
      // Fallback to regular diff
      try {
        const diff = execSync(
          `diff -u "${originalPath}" "${tempFile}" || true`,
          { encoding: 'utf8' }
        );
        
        // Clean up temp file
        fs.unlinkSync(tempFile);
        
        return diff;
      } catch (diffError) {
        // Final fallback: naive diff
        const original = fs.existsSync(originalPath) 
          ? fs.readFileSync(originalPath, 'utf8').split('\n')
          : [];
        const proposed = proposedContent.split('\n');
        
        // Clean up temp file
        fs.unlinkSync(tempFile);
        
        return generateNaiveDiff(original, proposed, originalPath);
      }
    }
  } catch (error) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw error;
  }
}

// Naive diff implementation as final fallback
function generateNaiveDiff(original, proposed, filePath) {
  const relativePath = path.relative(flags.root, filePath);
  let diff = `--- a/${relativePath}\n+++ b/${relativePath}\n`;
  
  // Simple line-by-line comparison
  const maxLines = Math.max(original.length, proposed.length);
  let hunkStart = -1;
  let hunkOriginal = [];
  let hunkProposed = [];
  
  function flushHunk() {
    if (hunkStart === -1) return;
    
    diff += `@@ -${hunkStart + 1},${hunkOriginal.length} +${hunkStart + 1},${hunkProposed.length} @@\n`;
    
    for (const line of hunkOriginal) {
      diff += `-${line}\n`;
    }
    for (const line of hunkProposed) {
      diff += `+${line}\n`;
    }
    
    hunkStart = -1;
    hunkOriginal = [];
    hunkProposed = [];
  }
  
  for (let i = 0; i < maxLines; i++) {
    const origLine = original[i] || '';
    const propLine = proposed[i] || '';
    
    if (origLine !== propLine) {
      if (hunkStart === -1) {
        hunkStart = i;
      }
      if (i < original.length) {
        hunkOriginal.push(origLine);
      }
      if (i < proposed.length) {
        hunkProposed.push(propLine);
      }
    } else {
      flushHunk();
    }
  }
  
  flushHunk();
  
  return diff;
}

// Count additions and removals in diff
function analyzeDiff(diff) {
  const lines = diff.split('\n');
  let added = 0;
  let removed = 0;
  
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    }
  }
  
  return { added, removed };
}

// Main function
async function main() {
  try {
    // Get proposed content
    const proposedContent = await getProposedContent();
    
    if (!proposedContent || proposedContent.trim().length === 0) {
      throw new Error('Proposed content is empty');
    }
    
    // Set up paths
    const featureDir = path.join(flags.root, 'docs', 'proposal', flags.feature);
    const originalPath = path.join(featureDir, 'INITIAL.md');
    const patchPath = path.join(featureDir, 'INITIAL.md.patch');
    
    // Ensure feature directory exists
    if (!fs.existsSync(featureDir)) {
      fs.mkdirSync(featureDir, { recursive: true });
    }
    
    // Check if original exists
    let originalExists = fs.existsSync(originalPath);
    if (!originalExists) {
      // Create empty file for diff purposes
      fs.writeFileSync(originalPath, '', 'utf8');
    }
    
    // Generate diff
    const diff = generateDiff(originalPath, proposedContent);
    
    // If we created an empty original, remove it
    if (!originalExists && fs.readFileSync(originalPath, 'utf8') === '') {
      fs.unlinkSync(originalPath);
    }
    
    // Write patch file
    fs.writeFileSync(patchPath, diff, 'utf8');
    
    // Analyze diff
    const stats = analyzeDiff(diff);
    
    // Output result
    const result = {
      ok: true,
      feature: flags.feature,
      patch: patchPath,
      added: stats.added,
      removed: stats.removed,
      originalExists
    };
    
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`✅ Patch created: ${patchPath}`);
      console.log(`   Added: ${stats.added} lines`);
      console.log(`   Removed: ${stats.removed} lines`);
      if (!originalExists) {
        console.log(`   Note: Original INITIAL.md does not exist (new file)`);
      }
    }
    
    process.exit(0);
  } catch (error) {
    const result = {
      ok: false,
      error: error.message
    };
    
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    
    process.exit(1);
  }
}

// Run
main();