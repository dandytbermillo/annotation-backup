#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

/**
 * Auto-organize context files when they grow beyond thresholds
 */
class ContextOrganizer {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.thresholds = {
      fileCount: 15,
      fileSize: 2000, // lines
      directorySize: 10 // files per directory
    };
  }

  async organize() {
    console.log('🗂️  Auto-organizing context...');
    
    // Check if organization is needed
    const stats = await this.analyzeStructure();
    
    if (!this.needsOrganization(stats)) {
      console.log('✓ Context is well-organized');
      return;
    }
    
    // Perform organization
    await this.splitLargeFiles();
    await this.archiveOldTasks();
    await this.consolidateKnowledge();
    await this.createIndex();
    
    console.log('✓ Organization complete');
  }

  async analyzeStructure() {
    const stats = {
      totalFiles: 0,
      largeFiles: [],
      directories: {},
      oldTasks: []
    };
    
    const analyze = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile() && entry.name.endsWith('.md')) {
          stats.totalFiles++;
          
          const content = await fs.readFile(fullPath, 'utf8');
          const lines = content.split('\n').length;
          
          if (lines > this.thresholds.fileSize) {
            stats.largeFiles.push({ path: fullPath, lines });
          }
          
          // Track directory sizes
          const dirPath = path.dirname(fullPath);
          stats.directories[dirPath] = (stats.directories[dirPath] || 0) + 1;
          
          // Check for old tasks
          if (fullPath.includes('/current/') && !fullPath.includes('.archived')) {
            const stat = await fs.stat(fullPath);
            const age = Date.now() - stat.mtime.getTime();
            if (age > 30 * 24 * 60 * 60 * 1000) { // 30 days
              stats.oldTasks.push({ path: fullPath, age });
            }
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await analyze(fullPath);
        }
      }
    };
    
    await analyze(this.contextRoot);
    return stats;
  }

  needsOrganization(stats) {
    if (stats.largeFiles.length > 0) return true;
    if (stats.oldTasks.length > 5) return true;
    
    for (const [dir, count] of Object.entries(stats.directories)) {
      if (count > this.thresholds.directorySize) return true;
    }
    
    return stats.totalFiles > this.thresholds.fileCount * 2;
  }

  async splitLargeFiles() {
    const learnedPath = path.join(this.contextRoot, 'knowledge', 'learned.md');
    
    try {
      const content = await fs.readFile(learnedPath, 'utf8');
      const lines = content.split('\n');
      
      if (lines.length > this.thresholds.fileSize) {
        console.log('  Splitting learned.md...');
        
        // Group by category
        const categories = {
          patterns: [],
          errors: [],
          decisions: [],
          general: []
        };
        
        let currentCategory = 'general';
        
        for (const line of lines) {
          if (line.includes('Pattern:') || line.includes('pattern')) {
            currentCategory = 'patterns';
          } else if (line.includes('Error:') || line.includes('error')) {
            currentCategory = 'errors';
          } else if (line.includes('Decision:') || line.includes('chose')) {
            currentCategory = 'decisions';
          }
          
          categories[currentCategory].push(line);
        }
        
        // Write to separate files
        for (const [category, categoryLines] of Object.entries(categories)) {
          if (categoryLines.length > 0) {
            const categoryPath = path.join(this.contextRoot, 'knowledge', category, 'from-learned.md');
            await fs.mkdir(path.dirname(categoryPath), { recursive: true });
            await fs.writeFile(categoryPath, categoryLines.join('\n'));
          }
        }
        
        // Keep only recent entries in learned.md
        const recentLines = lines.slice(-100);
        await fs.writeFile(learnedPath, recentLines.join('\n'));
      }
    } catch {}
  }

  async archiveOldTasks() {
    const currentDir = path.join(this.contextRoot, 'current');
    const archiveDir = path.join(currentDir, '.archived');
    await fs.mkdir(archiveDir, { recursive: true });
    
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    let archived = 0;
    
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(currentDir, entry.name);
        const stat = await fs.stat(filePath);
        const age = Date.now() - stat.mtime.getTime();
        
        if (age > 30 * 24 * 60 * 60 * 1000) { // 30 days
          const archivePath = path.join(archiveDir, entry.name);
          await fs.rename(filePath, archivePath);
          archived++;
        }
      }
    }
    
    if (archived > 0) {
      console.log(`  Archived ${archived} old tasks`);
    }
  }

  async consolidateKnowledge() {
    const knowledgeDir = path.join(this.contextRoot, 'knowledge');
    const categories = ['patterns', 'errors', 'decisions'];
    
    for (const category of categories) {
      const categoryDir = path.join(knowledgeDir, category);
      
      try {
        const files = await fs.readdir(categoryDir);
        
        if (files.length > this.thresholds.directorySize) {
          console.log(`  Consolidating ${category}...`);
          
          // Group similar files
          const groups = {};
          
          for (const file of files) {
            if (file.endsWith('.md')) {
              const topic = this.extractTopic(file);
              if (!groups[topic]) groups[topic] = [];
              groups[topic].push(file);
            }
          }
          
          // Merge similar files
          for (const [topic, topicFiles] of Object.entries(groups)) {
            if (topicFiles.length > 1) {
              const mergedContent = [];
              
              for (const file of topicFiles) {
                const content = await fs.readFile(path.join(categoryDir, file), 'utf8');
                mergedContent.push(content);
              }
              
              // Write merged file
              const mergedPath = path.join(categoryDir, `${topic}-consolidated.md`);
              await fs.writeFile(mergedPath, mergedContent.join('\n\n---\n\n'));
              
              // Remove original files
              for (const file of topicFiles) {
                await fs.unlink(path.join(categoryDir, file));
              }
            }
          }
        }
      } catch {}
    }
  }

  extractTopic(filename) {
    // Extract topic from filename
    const name = filename.replace('.md', '');
    const parts = name.split('-');
    
    if (parts.length > 2) {
      return parts[0];
    }
    return 'general';
  }

  async createIndex() {
    console.log('  Creating searchable index...');
    
    const index = {
      created: new Date().toISOString(),
      files: [],
      topics: {},
      keywords: {}
    };
    
    const indexFiles = async (dir, category = '') => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf8');
          const relativePath = path.relative(this.contextRoot, fullPath);
          
          const fileInfo = {
            path: relativePath,
            category: category || this.detectCategory(relativePath),
            title: this.extractTitle(content),
            keywords: this.extractKeywords(content),
            size: content.length,
            modified: (await fs.stat(fullPath)).mtime.toISOString()
          };
          
          index.files.push(fileInfo);
          
          // Update topic index
          const topic = this.extractTopic(entry.name);
          if (!index.topics[topic]) index.topics[topic] = [];
          index.topics[topic].push(relativePath);
          
          // Update keyword index
          for (const keyword of fileInfo.keywords) {
            if (!index.keywords[keyword]) index.keywords[keyword] = [];
            index.keywords[keyword].push(relativePath);
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await indexFiles(fullPath, category || entry.name);
        }
      }
    };
    
    await indexFiles(this.contextRoot);
    
    // Save index
    const indexPath = path.join(this.contextRoot, 'knowledge', 'index.json');
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    
    // Create markdown index
    const mdIndex = this.generateMarkdownIndex(index);
    await fs.writeFile(
      path.join(this.contextRoot, 'knowledge', 'index.md'),
      mdIndex
    );
  }

  detectCategory(filepath) {
    if (filepath.includes('/patterns/')) return 'patterns';
    if (filepath.includes('/errors/')) return 'errors';
    if (filepath.includes('/decisions/')) return 'decisions';
    if (filepath.includes('/current/')) return 'current';
    return 'general';
  }

  extractTitle(content) {
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('#')) {
        return line.replace(/^#+\s+/, '').trim();
      }
    }
    return 'Untitled';
  }

  extractKeywords(content) {
    const words = content.toLowerCase().split(/\s+/);
    const keywords = new Set();
    
    // Common important words
    const importantWords = [
      'pattern', 'error', 'decision', 'solution', 'problem',
      'todo', 'bug', 'feature', 'refactor', 'optimize',
      'api', 'database', 'auth', 'security', 'performance'
    ];
    
    for (const word of words) {
      if (importantWords.includes(word)) {
        keywords.add(word);
      }
    }
    
    return Array.from(keywords);
  }

  generateMarkdownIndex(index) {
    let md = `# Knowledge Index\n\nGenerated: ${index.created}\nTotal Files: ${index.files.length}\n\n`;
    
    // By category
    md += '## By Category\n\n';
    const byCategory = {};
    
    for (const file of index.files) {
      if (!byCategory[file.category]) byCategory[file.category] = [];
      byCategory[file.category].push(file);
    }
    
    for (const [category, files] of Object.entries(byCategory)) {
      md += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
      for (const file of files) {
        md += `- [${file.title}](../${file.path})\n`;
      }
      md += '\n';
    }
    
    // By topic
    md += '## By Topic\n\n';
    for (const [topic, files] of Object.entries(index.topics)) {
      if (files.length > 1) {
        md += `### ${topic}\n`;
        for (const file of files) {
          md += `- ${file}\n`;
        }
        md += '\n';
      }
    }
    
    return md;
  }
}

// CLI interface
if (require.main === module) {
  const organizer = new ContextOrganizer(path.join(__dirname, '..'));
  
  const command = process.argv[2];
  
  (async () => {
    if (command === 'enable') {
      // Set up cron job or file watcher
      console.log('🔄 Auto-organization enabled');
      console.log('Would set up file watcher or cron job here');
    } else {
      await organizer.organize();
    }
  })();
}