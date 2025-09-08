#!/usr/bin/env node

/**
 * Wrapper for create-feature.js that handles JSON input
 * Supports the --from parameter for /context-execute command
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Read JSON from stdin or parse arguments
async function getInput() {
  if (process.stdin.isTTY) {
    // Called directly with arguments
    const args = process.argv.slice(2);
    return {
      feature: args[0],
      draftPath: args[1],
      slug: args[2]
    };
  } else {
    // Read from stdin (piped JSON)
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk;
    }
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Error parsing JSON input:', e.message);
      process.exit(1);
    }
  }
}

// Generate slug from feature name
function generateSlug(featureName) {
  return featureName
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Find available directory name with incremental fallback
function findAvailableSlug(baseSlug, baseDir = 'docs/proposal') {
  let slug = baseSlug;
  let counter = 1;
  
  while (fs.existsSync(path.join(baseDir, slug))) {
    if (baseSlug === 'new_feature') {
      slug = `new_feature${counter}`;
    } else {
      slug = `${baseSlug}_${counter}`;
    }
    counter++;
  }
  
  return slug;
}

async function main() {
  const input = await getInput();
  
  if (!input.feature) {
    console.error('❌ Feature name is required');
    process.exit(1);
  }
  
  // Handle --from parameter (draftPath)
  if (input.draftPath) {
    const fullPath = path.resolve(input.draftPath);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ Draft file not found: ${input.draftPath}`);
      process.exit(1);
    }
    
    console.log(`📄 Reading draft from: ${input.draftPath}`);
    const draftContent = fs.readFileSync(fullPath, 'utf8');
    const originalFilename = input.originalFilename || path.basename(fullPath);
    
    // Generate slug from feature name or use provided slug
    const baseSlug = input.slug || generateSlug(input.feature) || 'new_feature';
    
    // Check if feature already exists and find available name
    const finalSlug = findAvailableSlug(baseSlug);
    
    // If we had to change the slug, inform the user
    if (finalSlug !== baseSlug) {
      if (input.slug) {
        console.error(`❌ Feature '${input.slug}' already exists!`);
        console.error(`💡 Please choose a different --slug name`);
        console.error(`   Suggested: --slug ${finalSlug}`);
        process.exit(1);
      } else {
        console.log(`⚠️  Feature '${baseSlug}' exists, using '${finalSlug}' instead`);
      }
    }
    
    const targetDir = path.join('docs/proposal', finalSlug);
    
    // Ensure directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      console.log(`✅ Created feature directory: ${targetDir}`);
    }
    
    // Copy draft with original filename
    const targetFile = path.join(targetDir, originalFilename);
    fs.writeFileSync(targetFile, draftContent);
    console.log(`✅ Copied draft to: ${targetFile}`);
    
    // Create standard structure
    const dirs = ['reports', 'patches', 'post-implementation-fixes', 'test_pages', 'test_scripts'];
    dirs.forEach(dir => {
      const dirPath = path.join(targetDir, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    });
    
    // Create README files
    const patchesReadme = path.join(targetDir, 'patches', 'README.md');
    if (!fs.existsSync(patchesReadme)) {
      fs.writeFileSync(patchesReadme, '# Patches\n\nCode patches for this feature.\n');
    }
    
    const fixesReadme = path.join(targetDir, 'post-implementation-fixes', 'README.md');
    if (!fs.existsSync(fixesReadme)) {
      fs.writeFileSync(fixesReadme, '# Post-Implementation Fixes\n\nFixes applied after implementation.\n');
    }
    
    console.log('✅ Feature created successfully!');
    console.log(`📁 Location: ${targetDir}`);
    console.log(`📄 Draft preserved as: ${originalFilename}`);
    
    // Return success
    const result = {
      ok: true,
      command: 'execute',
      result: {
        feature: input.feature,
        slug: finalSlug,
        path: targetDir,
        draftFile: originalFilename,
        created: true
      }
    };
    
    if (input.autoConfirm) {
      console.log(JSON.stringify(result));
    }
    
  } else {
    // No draft provided - fall back to interactive mode
    console.log('⚠️  No draft file provided, entering interactive mode...');
    
    // Call original create-feature.js
    const child = spawn('node', ['context-os/create-feature.js', input.feature], {
      stdio: 'inherit'
    });
    
    child.on('exit', (code) => {
      process.exit(code);
    });
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});