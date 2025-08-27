#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

/**
 * Validate Context OS structure for CI/CD
 */
class StructureValidator {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.errors = [];
    this.warnings = [];
  }

  async validate() {
    console.log('🔍 Validating Context OS structure...');
    
    // Check required directories
    await this.checkRequiredDirectories();
    
    // Check required files
    await this.checkRequiredFiles();
    
    // Validate file formats
    await this.validateFileFormats();
    
    // Check file sizes
    await this.checkFileSizes();
    
    // Validate references
    await this.validateReferences();
    
    // Report results
    this.reportResults();
    
    return this.errors.length === 0;
  }

  async checkRequiredDirectories() {
    const requiredDirs = [
      'knowledge',
      'knowledge/patterns',
      'knowledge/errors',
      'knowledge/decisions',
      'current',
      'rules',
      'tasks',
      'team',
      'cache'
    ];
    
    for (const dir of requiredDirs) {
      const dirPath = path.join(this.contextRoot, dir);
      try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) {
          this.errors.push(`${dir} exists but is not a directory`);
        }
      } catch {
        this.errors.push(`Required directory missing: ${dir}`);
      }
    }
  }

  async checkRequiredFiles() {
    const requiredFiles = [
      'project.md',
      'README.md',
      'rules/default.json',
      'config/settings.json'
    ];
    
    for (const file of requiredFiles) {
      const filePath = path.join(this.contextRoot, file);
      try {
        await fs.access(filePath);
      } catch {
        this.errors.push(`Required file missing: ${file}`);
      }
    }
  }

  async validateFileFormats() {
    // Validate JSON files
    const jsonFiles = [
      'rules/default.json',
      'rules/custom.json',
      'config/settings.json'
    ];
    
    for (const file of jsonFiles) {
      const filePath = path.join(this.contextRoot, file);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        JSON.parse(content);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.errors.push(`Invalid JSON in ${file}: ${error.message}`);
        }
      }
    }
    
    // Validate markdown files
    const mdFiles = await this.findMarkdownFiles();
    for (const file of mdFiles) {
      await this.validateMarkdown(file);
    }
  }

  async checkFileSizes() {
    const maxFileSize = 1024 * 1024; // 1MB
    const warningSize = 500 * 1024; // 500KB
    
    const checkDir = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isFile()) {
            const stat = await fs.stat(fullPath);
            const relativePath = path.relative(this.contextRoot, fullPath);
            
            if (stat.size > maxFileSize) {
              this.errors.push(`File too large: ${relativePath} (${Math.round(stat.size / 1024)}KB)`);
            } else if (stat.size > warningSize) {
              this.warnings.push(`Large file: ${relativePath} (${Math.round(stat.size / 1024)}KB)`);
            }
          } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await checkDir(fullPath);
          }
        }
      } catch {}
    };
    
    await checkDir(this.contextRoot);
  }

  async validateReferences() {
    // Check for broken internal links
    const mdFiles = await this.findMarkdownFiles();
    
    for (const file of mdFiles) {
      const content = await fs.readFile(file, 'utf8');
      const links = this.extractInternalLinks(content);
      
      for (const link of links) {
        const linkPath = path.resolve(path.dirname(file), link);
        try {
          await fs.access(linkPath);
        } catch {
          const relativePath = path.relative(this.contextRoot, file);
          this.warnings.push(`Broken link in ${relativePath}: ${link}`);
        }
      }
    }
  }

  async findMarkdownFiles() {
    const files = [];
    
    const searchDir = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await searchDir(fullPath);
          }
        }
      } catch {}
    };
    
    await searchDir(this.contextRoot);
    return files;
  }

  async validateMarkdown(file) {
    const content = await fs.readFile(file, 'utf8');
    const relativePath = path.relative(this.contextRoot, file);
    
    // Check for required sections in specific files
    if (relativePath === 'project.md') {
      const requiredSections = ['# Project', '## Overview', '## Architecture'];
      for (const section of requiredSections) {
        if (!content.includes(section)) {
          this.warnings.push(`Missing section in project.md: ${section}`);
        }
      }
    }
    
    // Check for empty files
    if (content.trim().length === 0) {
      this.warnings.push(`Empty file: ${relativePath}`);
    }
    
    // Check for TODO markers
    const todoCount = (content.match(/TODO:/g) || []).length;
    if (todoCount > 5) {
      this.warnings.push(`Many TODOs in ${relativePath}: ${todoCount} found`);
    }
  }

  extractInternalLinks(content) {
    const links = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    
    while ((match = linkRegex.exec(content)) !== null) {
      const url = match[2];
      if (!url.startsWith('http') && !url.startsWith('#')) {
        links.push(url);
      }
    }
    
    return links;
  }

  reportResults() {
    console.log('\n📊 Validation Results');
    console.log('===================');
    
    if (this.errors.length === 0) {
      console.log('✅ No errors found');
    } else {
      console.log(`❌ ${this.errors.length} errors found:`);
      for (const error of this.errors) {
        console.log(`  - ${error}`);
      }
    }
    
    if (this.warnings.length > 0) {
      console.log(`\n⚠️  ${this.warnings.length} warnings:`);
      for (const warning of this.warnings.slice(0, 10)) {
        console.log(`  - ${warning}`);
      }
      if (this.warnings.length > 10) {
        console.log(`  ... and ${this.warnings.length - 10} more`);
      }
    }
    
    // Save report
    const report = {
      timestamp: new Date().toISOString(),
      errors: this.errors,
      warnings: this.warnings,
      passed: this.errors.length === 0
    };
    
    const reportsDir = path.join(this.contextRoot, 'reports');
    fs.mkdir(reportsDir, { recursive: true }).then(() => {
      fs.writeFile(
        path.join(reportsDir, 'structure-validation.json'),
        JSON.stringify(report, null, 2)
      );
    });
  }
}

// Run validation
if (require.main === module) {
  const contextRoot = path.join(__dirname, '..');
  const validator = new StructureValidator(contextRoot);
  
  validator.validate().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}