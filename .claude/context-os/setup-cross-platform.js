#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

/**
 * Cross-platform setup script for Context-OS
 */
class ContextOSSetup {
  constructor() {
    this.platform = os.platform();
    this.isWindows = this.platform === 'win32';
    this.contextOsDir = __dirname;
    this.projectRoot = path.resolve(this.contextOsDir, '..', '..');
  }

  async run() {
    console.log('🚀 Setting up Context-OS...');
    console.log(`Platform: ${this.platform}`);
    console.log(`Project root: ${this.projectRoot}`);
    
    try {
      await this.checkPrerequisites();
      await this.installDependencies();
      await this.createDirectories();
      await this.setupPermissions();
      await this.setupGitHooks();
      await this.initializeConfigs();
      await this.buildInitialIndex();
      await this.showCompletionMessage();
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      process.exit(1);
    }
  }

  async checkPrerequisites() {
    console.log('📋 Checking prerequisites...');
    
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    if (majorVersion < 14) {
      throw new Error(`Node.js 14 or higher required (found ${nodeVersion})`);
    }
    
    // Check if npm is available
    try {
      execSync('npm --version', { stdio: 'ignore' });
    } catch {
      throw new Error('npm is required but not found in PATH');
    }
    
    console.log('✓ Prerequisites satisfied');
  }

  async installDependencies() {
    console.log('📦 Installing dependencies...');
    
    const packageJsonPath = path.join(this.contextOsDir, 'package.json');
    try {
      await fs.access(packageJsonPath);
      
      // Use appropriate command for the platform
      const installCmd = this.isWindows 
        ? 'npm.cmd install --silent' 
        : 'npm install --silent';
      
      execSync(installCmd, { 
        cwd: this.contextOsDir,
        stdio: 'inherit'
      });
      
      console.log('✓ Dependencies installed');
    } catch (error) {
      console.warn('⚠️  No package.json found or install failed, continuing...');
    }
  }

  async createDirectories() {
    console.log('📁 Creating directory structure...');
    
    const directories = [
      'knowledge/patterns',
      'knowledge/errors', 
      'knowledge/decisions',
      'current',
      'tasks',
      'tasks/archive',
      'cache',
      'logs',
      'quarantine',
      'team/shared',
      'team/votes',
      'search/indexes',
      'backup'
    ];
    
    for (const dir of directories) {
      const fullPath = path.join(this.contextOsDir, dir);
      await fs.mkdir(fullPath, { recursive: true });
    }
    
    console.log('✓ Directory structure created');
  }

  async setupPermissions() {
    console.log('🔐 Setting up permissions...');
    
    if (!this.isWindows) {
      // Make scripts executable on Unix-like systems
      const scripts = [
        'bin/context',
        'bin/context-index',
        'bin/context-hook',
        'setup.sh',
        'workflows/auto-learn.sh',
        'hooks/pre-task.sh',
        'hooks/post-task.sh'
      ];
      
      for (const script of scripts) {
        const scriptPath = path.join(this.contextOsDir, script);
        try {
          await fs.access(scriptPath);
          await fs.chmod(scriptPath, '755');
        } catch {
          // Script doesn't exist, skip
        }
      }
    }
    
    console.log('✓ Permissions configured');
  }

  async setupGitHooks() {
    console.log('🔗 Setting up git hooks...');
    
    // Check if this is a git repository
    const gitDir = path.join(this.projectRoot, '.git');
    try {
      await fs.access(gitDir);
    } catch {
      console.log('⚠️  Not a git repository, skipping hooks');
      return;
    }
    
    const hooksDir = path.join(gitDir, 'hooks');
    await fs.mkdir(hooksDir, { recursive: true });
    
    // Create cross-platform hooks
    await this.createGitHook('pre-commit');
    await this.createGitHook('post-commit');
    await this.createGitHook('post-merge');
    
    console.log('✓ Git hooks installed (disabled by default)');
  }

  async createGitHook(hookName) {
    const hookPath = path.join(this.projectRoot, '.git', 'hooks', hookName);
    
    if (this.isWindows) {
      // Windows batch file
      const content = `@echo off
rem Context-OS ${hookName} hook
rem To enable: rename this file from ${hookName}.sample to ${hookName}

set CONTEXT_OS_DIR=%~dp0\\..\\..\\.\\.claude\\context-os
set NODE_PATH=%CONTEXT_OS_DIR%\\node_modules

if exist "%CONTEXT_OS_DIR%\\hooks\\${hookName}.js" (
  node "%CONTEXT_OS_DIR%\\hooks\\${hookName}.js" %*
) else if exist "%CONTEXT_OS_DIR%\\bin\\context-hook" (
  node "%CONTEXT_OS_DIR%\\bin\\context-hook" ${hookName} %*
)
`;
      await fs.writeFile(`${hookPath}.sample.bat`, content);
    } else {
      // Unix shell script
      const content = `#!/bin/bash
# Context-OS ${hookName} hook
# To enable: rename this file from ${hookName}.sample to ${hookName}

CONTEXT_OS_DIR="$(git rev-parse --show-toplevel)/.claude/context-os"

if [ -f "$CONTEXT_OS_DIR/hooks/${hookName}.js" ]; then
  node "$CONTEXT_OS_DIR/hooks/${hookName}.js" "$@"
elif [ -x "$CONTEXT_OS_DIR/bin/context-hook" ]; then
  "$CONTEXT_OS_DIR/bin/context-hook" ${hookName} "$@"
fi
`;
      await fs.writeFile(`${hookPath}.sample`, content);
      if (!this.isWindows) {
        await fs.chmod(`${hookPath}.sample`, '755');
      }
    }
  }

  async initializeConfigs() {
    console.log('⚙️  Initializing configurations...');
    
    // Create default knowledge index
    const indexPath = path.join(this.contextOsDir, 'knowledge', 'index.md');
    const indexContent = `# Knowledge Index

This file tracks all knowledge entries in the Context-OS system.

## Categories

### Patterns
- Best practices and recurring solutions
- Located in: knowledge/patterns/

### Errors
- Common errors and their solutions
- Located in: knowledge/errors/

### Decisions
- Architectural and design decisions
- Located in: knowledge/decisions/

## Quick Links
- [Common Issues](errors/common-issues.md)
- [Architecture Choices](decisions/architecture-choices.md)
- [YJS Integration Patterns](patterns/yjs-integration.md)

---
Generated: ${new Date().toISOString()}
`;
    
    try {
      await fs.access(indexPath);
    } catch {
      await fs.writeFile(indexPath, indexContent);
    }
    
    // Create default project context
    const projectPath = path.join(this.contextOsDir, 'project.md');
    const projectContent = `# Project Context

## Overview
This project uses Context-OS for intelligent context management.

## Key Technologies
- ${await this.detectTechnologies()}

## Important Files
- CLAUDE.md - Project conventions and rules
- .claude/context-os/ - Context management system

## Setup Status
- Initialized: ${new Date().toISOString()}
- Platform: ${this.platform}
- Node Version: ${process.version}
`;
    
    try {
      await fs.access(projectPath);
    } catch {
      await fs.writeFile(projectPath, projectContent);
    }
    
    console.log('✓ Configurations initialized');
  }

  async detectTechnologies() {
    const techs = [];
    const projectFiles = ['package.json', 'composer.json', 'requirements.txt', 'Gemfile', 'go.mod'];
    
    for (const file of projectFiles) {
      try {
        await fs.access(path.join(this.projectRoot, file));
        switch (file) {
          case 'package.json':
            const pkg = JSON.parse(await fs.readFile(path.join(this.projectRoot, file), 'utf8'));
            if (pkg.dependencies?.react) techs.push('React');
            if (pkg.dependencies?.vue) techs.push('Vue');
            if (pkg.dependencies?.next) techs.push('Next.js');
            if (pkg.devDependencies?.typescript) techs.push('TypeScript');
            break;
          case 'composer.json': techs.push('PHP'); break;
          case 'requirements.txt': techs.push('Python'); break;
          case 'Gemfile': techs.push('Ruby'); break;
          case 'go.mod': techs.push('Go'); break;
        }
      } catch {
        // File doesn't exist
      }
    }
    
    return techs.length > 0 ? techs.join(', ') : 'Unknown';
  }

  async buildInitialIndex() {
    console.log('🔍 Building initial knowledge index...');
    
    // Create a simple index builder
    const indexBuilder = `
const fs = require('fs').promises;
const path = require('path');

async function buildIndex() {
  const knowledgeDir = path.join(__dirname, '..', 'knowledge');
  const indexPath = path.join(__dirname, '..', 'search', 'indexes', 'knowledge.json');
  
  const index = {
    version: '1.0.0',
    created: new Date().toISOString(),
    entries: []
  };
  
  // Scan knowledge directory
  async function scanDir(dir, category) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = await fs.readFile(path.join(dir, file), 'utf8');
          const title = content.split('\\n')[0].replace(/^#\\s*/, '');
          index.entries.push({
            id: category + '/' + file,
            category,
            title,
            file: path.relative(knowledgeDir, path.join(dir, file)),
            size: content.length,
            modified: (await fs.stat(path.join(dir, file))).mtime.toISOString()
          });
        }
      }
    } catch (e) {
      // Directory doesn't exist
    }
  }
  
  await scanDir(path.join(knowledgeDir, 'patterns'), 'patterns');
  await scanDir(path.join(knowledgeDir, 'errors'), 'errors');
  await scanDir(path.join(knowledgeDir, 'decisions'), 'decisions');
  
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  console.log(\`✓ Index built with \${index.entries.length} entries\`);
}

if (require.main === module) {
  buildIndex().catch(console.error);
}

module.exports = { buildIndex };
`;
    
    const indexBuilderPath = path.join(this.contextOsDir, 'search', 'index-builder.js');
    await fs.writeFile(indexBuilderPath, indexBuilder);
    
    // Run the index builder
    try {
      execSync(`node "${indexBuilderPath}"`, { cwd: this.contextOsDir, stdio: 'inherit' });
    } catch {
      console.warn('⚠️  Initial index build failed, continuing...');
    }
  }

  async showCompletionMessage() {
    console.log('\n✨ Context-OS setup complete!\n');
    
    console.log('📚 Next steps:\n');
    
    console.log('1. Enable features you need by editing:');
    console.log(`   ${path.join(this.contextOsDir, 'config', 'settings.json')}\n`);
    
    console.log('2. To use the context command globally:');
    if (this.isWindows) {
      console.log(`   Add to PATH: ${path.join(this.contextOsDir, 'bin')}`);
      console.log('   Or use: node "%CONTEXT_OS_DIR%\\bin\\context" <command>\n');
    } else {
      console.log(`   export PATH="${path.join(this.contextOsDir, 'bin')}:$PATH"`);
      console.log(`   Or use: ${path.join(this.contextOsDir, 'bin', 'context')} <command>\n`);
    }
    
    console.log('3. To enable git hooks (optional):');
    console.log('   Review and rename .git/hooks/*.sample files\n');
    
    console.log('4. Start with:');
    console.log('   context init          # Initialize for current task');
    console.log('   context load <query>  # Load relevant context');
    console.log('   context learn         # Extract patterns from recent work\n');
    
    console.log('⚠️  Security notes:');
    console.log('   - All automation features are DISABLED by default');
    console.log('   - Git hooks are created as .sample files (rename to enable)');
    console.log('   - Secret scanning is ENABLED by default');
    console.log('   - Review security settings in config/security-config.json\n');
  }
}

// Run setup
if (require.main === module) {
  const setup = new ContextOSSetup();
  setup.run().catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
}

module.exports = { ContextOSSetup };