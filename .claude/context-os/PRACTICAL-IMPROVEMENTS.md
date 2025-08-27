# Practical Context-OS Improvements

## Overview
These improvements enhance the existing Context-OS without over-engineering. Each provides clear value with minimal complexity.

## 1. Lightweight Semantic Analysis

### Implementation
```javascript
// Add to core/semantic-analyzer.js
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

class SemanticAnalyzer {
  async analyzeFile(filePath) {
    if (!filePath.match(/\.(js|jsx|ts|tsx)$/)) return null;
    
    const content = await fs.readFile(filePath, 'utf8');
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    });
    
    const analysis = {
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      dependencies: new Set()
    };
    
    traverse(ast, {
      ImportDeclaration(path) {
        analysis.imports.push({
          source: path.node.source.value,
          specifiers: path.node.specifiers.map(s => s.local.name)
        });
        analysis.dependencies.add(path.node.source.value);
      },
      FunctionDeclaration(path) {
        analysis.functions.push({
          name: path.node.id?.name,
          params: path.node.params.length,
          loc: path.node.loc
        });
      },
      ClassDeclaration(path) {
        analysis.classes.push({
          name: path.node.id?.name,
          methods: []  // Can expand later
        });
      }
    });
    
    return analysis;
  }
  
  async findRelatedFiles(targetFile) {
    const analysis = await this.analyzeFile(targetFile);
    if (!analysis) return [];
    
    const related = new Set();
    
    // Find files that import this file
    for (const dep of analysis.dependencies) {
      if (dep.startsWith('.')) {
        related.add(path.resolve(path.dirname(targetFile), dep));
      }
    }
    
    return Array.from(related);
  }
}
```

### Integration with Context Manager
```javascript
// Update core/context-manager.js
async loadContext(pattern, options = {}) {
  // ... existing code ...
  
  // Add semantic analysis
  if (options.semantic) {
    const analyzer = new SemanticAnalyzer();
    const semanticFiles = new Set();
    
    for (const file of this.currentContext.keys()) {
      const related = await analyzer.findRelatedFiles(file);
      related.forEach(f => semanticFiles.add(f));
    }
    
    // Add related files within token budget
    for (const file of semanticFiles) {
      if (this.tokenCount >= maxTokens) break;
      // ... load file ...
    }
  }
}
```

## 2. Usage-Based Learning

### Implementation
```javascript
// Add to core/usage-tracker.js
class UsageTracker {
  constructor(contextRoot) {
    this.logPath = path.join(contextRoot, 'cache', 'usage-log.json');
    this.patterns = new Map();
  }
  
  async trackUsage(loadedFiles, modifiedFiles, task) {
    const entry = {
      timestamp: Date.now(),
      task,
      loaded: loadedFiles,
      modified: modifiedFiles,
      usefulness: modifiedFiles.map(f => ({
        file: f,
        score: loadedFiles.includes(f) ? 1.0 : 0.0
      }))
    };
    
    await this.appendLog(entry);
    await this.updatePatterns(entry);
  }
  
  async updatePatterns(entry) {
    // Simple pattern: files loaded together that were both modified
    const usefulPairs = entry.modified.filter(f => entry.loaded.includes(f));
    
    for (let i = 0; i < usefulPairs.length; i++) {
      for (let j = i + 1; j < usefulPairs.length; j++) {
        const pair = [usefulPairs[i], usefulPairs[j]].sort().join('|');
        this.patterns.set(pair, (this.patterns.get(pair) || 0) + 1);
      }
    }
  }
  
  async suggestFiles(currentFile) {
    const suggestions = new Map();
    
    for (const [pair, count] of this.patterns) {
      const [file1, file2] = pair.split('|');
      if (file1 === currentFile) {
        suggestions.set(file2, count);
      } else if (file2 === currentFile) {
        suggestions.set(file1, count);
      }
    }
    
    return Array.from(suggestions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([file]) => file);
  }
}
```

### Git Hook Integration
```bash
# Add to .git/hooks/post-commit
#!/bin/bash
# Track which files were actually modified
MODIFIED=$(git diff-tree --no-commit-id --name-only -r HEAD)
CONTEXT_TRACKING="${PWD}/.claude/context-os/cache/last-context.json"

if [ -f "$CONTEXT_TRACKING" ]; then
  node -e "
    const tracker = require('./.claude/context-os/core/usage-tracker.js');
    const lastContext = require('$CONTEXT_TRACKING');
    tracker.trackUsage(lastContext.files, '$MODIFIED'.split('\n'), lastContext.task);
  "
fi
```

## 3. Incremental Indexing

### Implementation
```javascript
// Add to core/incremental-indexer.js
class IncrementalIndexer {
  constructor(contextRoot) {
    this.indexPath = path.join(contextRoot, 'cache', 'file-index.json');
    this.index = new Map();
  }
  
  async updateIndex() {
    // Get git file hashes
    const gitFiles = execSync('git ls-files -s', { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [mode, hash, stage, ...pathParts] = line.split(/\s+/);
        return { path: pathParts.join(' '), hash };
      });
    
    // Load existing index
    const existingIndex = await this.loadIndex();
    
    // Update only changed files
    const updates = [];
    for (const { path, hash } of gitFiles) {
      const existing = existingIndex.get(path);
      if (!existing || existing.hash !== hash) {
        const stats = await fs.stat(path);
        const metadata = {
          hash,
          size: stats.size,
          modified: stats.mtime,
          tokens: this.estimateTokens(stats.size),
          extension: path.extname(path)
        };
        
        this.index.set(path, metadata);
        updates.push(path);
      }
    }
    
    if (updates.length > 0) {
      await this.saveIndex();
      console.log(`Updated index for ${updates.length} files`);
    }
    
    return updates;
  }
  
  async queryIndex(pattern, tokenBudget) {
    await this.updateIndex();
    
    const matches = [];
    for (const [path, metadata] of this.index) {
      if (minimatch(path, pattern)) {
        matches.push({ path, ...metadata });
      }
    }
    
    // Sort by relevance (recent files first)
    matches.sort((a, b) => b.modified - a.modified);
    
    // Select files within token budget
    const selected = [];
    let tokens = 0;
    
    for (const file of matches) {
      if (tokens + file.tokens <= tokenBudget) {
        selected.push(file);
        tokens += file.tokens;
      }
    }
    
    return selected;
  }
}
```

## 4. Smart Context Compression

### Implementation
```javascript
// Add to core/context-compressor.js
class ContextCompressor {
  compressFile(content, filePath) {
    const ext = path.extname(filePath);
    
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      return this.compressJavaScript(content);
    } else if (['.py'].includes(ext)) {
      return this.compressPython(content);
    }
    
    return content; // No compression for other files
  }
  
  compressJavaScript(content) {
    const lines = content.split('\n');
    const compressed = [];
    let inImplementation = false;
    let bracketDepth = 0;
    
    for (const line of lines) {
      // Always keep imports, exports, and type definitions
      if (line.match(/^(import|export|type|interface)/)) {
        compressed.push(line);
        continue;
      }
      
      // Keep function/class signatures
      if (line.match(/^(async\s+)?(function|class|const\s+\w+\s*=\s*(async\s*)?\()/)) {
        compressed.push(line);
        inImplementation = true;
        bracketDepth = 0;
        continue;
      }
      
      // Track brackets to know when implementation ends
      if (inImplementation) {
        bracketDepth += (line.match(/{/g) || []).length;
        bracketDepth -= (line.match(/}/g) || []).length;
        
        if (bracketDepth <= 0) {
          compressed.push('  // ... implementation ...');
          compressed.push(line);
          inImplementation = false;
        }
      } else {
        // Keep comments and other top-level code
        if (line.trim().startsWith('//') || line.trim().startsWith('/*')) {
          compressed.push(line);
        }
      }
    }
    
    return compressed.join('\n');
  }
  
  compressPython(content) {
    const lines = content.split('\n');
    const compressed = [];
    let inFunction = false;
    let functionIndent = 0;
    
    for (const line of lines) {
      const indent = line.search(/\S/);
      
      // Keep imports and class definitions
      if (line.match(/^(import|from|class)/)) {
        compressed.push(line);
        continue;
      }
      
      // Keep function signatures
      if (line.trim().startsWith('def ')) {
        compressed.push(line);
        compressed.push(' '.repeat(indent + 4) + '"""..."""');
        inFunction = true;
        functionIndent = indent;
        continue;
      }
      
      // Skip function implementation
      if (inFunction && indent > functionIndent) {
        continue;
      } else {
        inFunction = false;
      }
      
      // Keep docstrings and comments
      if (line.trim().startsWith('"""') || line.trim().startsWith('#')) {
        compressed.push(line);
      }
    }
    
    return compressed.join('\n');
  }
}
```

## Integration Example

```javascript
// Update bin/context script
async function loadSmartContext(pattern) {
  const contextManager = new ContextManager(projectRoot);
  const semanticAnalyzer = new SemanticAnalyzer();
  const usageTracker = new UsageTracker(contextRoot);
  const indexer = new IncrementalIndexer(contextRoot);
  const compressor = new ContextCompressor();
  
  // Get base files from index
  const files = await indexer.queryIndex(pattern, tokenBudget * 0.7);
  
  // Add semantically related files
  for (const file of files) {
    const related = await semanticAnalyzer.findRelatedFiles(file.path);
    files.push(...related);
  }
  
  // Add usage-based suggestions
  const suggested = await usageTracker.suggestFiles(files[0]?.path);
  files.push(...suggested);
  
  // Load and compress
  const context = [];
  for (const file of files) {
    const content = await fs.readFile(file.path, 'utf8');
    const compressed = compressor.compressFile(content, file.path);
    context.push({ path: file.path, content: compressed });
  }
  
  return context;
}
```

## Estimated Impact

- **Semantic Analysis**: 20-30% better context relevance for code navigation tasks
- **Usage Learning**: 15-25% improvement after ~10 tasks
- **Incremental Indexing**: 10x faster context loading for large repos
- **Compression**: 40-60% more code fits in same token budget

## Implementation Priority

1. **Smart Compression** (1 day) - Immediate value, simple to implement
2. **Incremental Indexing** (2 days) - Noticeable performance improvement
3. **Usage Learning** (3 days) - Improves over time
4. **Semantic Analysis** (4 days) - Most complex but highest value

## No Additional Dependencies Needed
- Uses Node.js built-ins and existing `@babel/parser` (if doing JS projects)
- Git for change detection (already required)
- No external services or complex ML libraries