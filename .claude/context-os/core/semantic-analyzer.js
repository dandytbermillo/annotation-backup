#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

/**
 * Lightweight Semantic Analyzer - Analyzes code dependencies and relationships
 * Uses regex-based parsing for simplicity (can upgrade to AST later)
 */
class SemanticAnalyzer {
  constructor() {
    this.cache = new Map();
    this.dependencyGraph = new Map();
  }
  
  /**
   * Analyze a file and extract semantic information
   */
  async analyzeFile(filePath) {
    // Check cache
    const cached = this.cache.get(filePath);
    if (cached && cached.mtime) {
      try {
        const stats = await fs.stat(filePath);
        if (stats.mtime.getTime() === cached.mtime) {
          return cached.analysis;
        }
      } catch (e) {
        // File might have been deleted
      }
    }
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath);
      
      let analysis = null;
      
      if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
        analysis = this.analyzeJavaScript(content, filePath);
      } else if (['.py'].includes(ext)) {
        analysis = this.analyzePython(content, filePath);
      } else if (['.go'].includes(ext)) {
        analysis = this.analyzeGo(content, filePath);
      } else if (['.rs'].includes(ext)) {
        analysis = this.analyzeRust(content, filePath);
      } else {
        analysis = this.analyzeGeneric(content, filePath);
      }
      
      // Cache the analysis
      this.cache.set(filePath, {
        analysis,
        mtime: stats.mtime.getTime()
      });
      
      return analysis;
    } catch (e) {
      return null;
    }
  }
  
  /**
   * Analyze JavaScript/TypeScript files
   */
  analyzeJavaScript(content, filePath) {
    const analysis = {
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      interfaces: [],
      dependencies: new Set(),
      symbols: new Set()
    };
    
    const lines = content.split('\n');
    
    // Extract imports
    const importRegex = /^import\s+(?:(?:\{([^}]+)\}|(\w+)|(\*\s+as\s+\w+))\s+from\s+)?['"]([^'"]+)['"]/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const source = match[4];
      const specifiers = match[1] ? match[1].split(',').map(s => s.trim()) : 
                        match[2] ? [match[2]] : 
                        match[3] ? [match[3]] : [];
      
      analysis.imports.push({
        source,
        specifiers,
        isRelative: source.startsWith('.'),
        isNodeModule: !source.startsWith('.') && !source.startsWith('/')
      });
      
      if (source.startsWith('.')) {
        const resolvedPath = path.resolve(path.dirname(filePath), source);
        analysis.dependencies.add(resolvedPath);
      }
    }
    
    // Extract exports
    const exportRegex = /export\s+(?:(default)\s+)?(?:(const|let|var|function|class|interface|type|enum)\s+)?(\w+)?/g;
    while ((match = exportRegex.exec(content)) !== null) {
      if (match[3]) {
        analysis.exports.push({
          name: match[3],
          type: match[2] || 'value',
          isDefault: !!match[1]
        });
        analysis.symbols.add(match[3]);
      }
    }
    
    // Extract named exports
    const namedExportRegex = /export\s*\{([^}]+)\}/g;
    while ((match = namedExportRegex.exec(content)) !== null) {
      const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
      names.forEach(name => {
        analysis.exports.push({ name, type: 'value', isDefault: false });
        analysis.symbols.add(name);
      });
    }
    
    // Extract functions
    const functionRegex = /(?:^|\s)(async\s+)?function\s+(\w+)\s*\([^)]*\)/gm;
    while ((match = functionRegex.exec(content)) !== null) {
      analysis.functions.push({
        name: match[2],
        isAsync: !!match[1],
        line: content.substring(0, match.index).split('\n').length
      });
      analysis.symbols.add(match[2]);
    }
    
    // Extract arrow functions assigned to variables
    const arrowFunctionRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
    while ((match = arrowFunctionRegex.exec(content)) !== null) {
      analysis.functions.push({
        name: match[1],
        isArrow: true,
        line: content.substring(0, match.index).split('\n').length
      });
      analysis.symbols.add(match[1]);
    }
    
    // Extract classes
    const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
    while ((match = classRegex.exec(content)) !== null) {
      analysis.classes.push({
        name: match[1],
        extends: match[2] || null,
        line: content.substring(0, match.index).split('\n').length
      });
      analysis.symbols.add(match[1]);
    }
    
    // Extract interfaces (TypeScript)
    const interfaceRegex = /interface\s+(\w+)(?:\s+extends\s+([^{]+))?/g;
    while ((match = interfaceRegex.exec(content)) !== null) {
      analysis.interfaces.push({
        name: match[1],
        extends: match[2] ? match[2].split(',').map(s => s.trim()) : [],
        line: content.substring(0, match.index).split('\n').length
      });
      analysis.symbols.add(match[1]);
    }
    
    // Extract type definitions (TypeScript)
    const typeRegex = /type\s+(\w+)\s*=/g;
    while ((match = typeRegex.exec(content)) !== null) {
      analysis.symbols.add(match[1]);
    }
    
    // Detect test file
    analysis.isTest = this.isTestFile(filePath, content);
    
    // Detect framework
    analysis.framework = this.detectJavaScriptFramework(content, analysis.imports);
    
    return analysis;
  }
  
  /**
   * Analyze Python files
   */
  analyzePython(content, filePath) {
    const analysis = {
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      dependencies: new Set(),
      symbols: new Set()
    };
    
    // Extract imports
    const importRegex = /^(?:from\s+([\w.]+)\s+)?import\s+([\w\s,*]+)(?:\s+as\s+(\w+))?/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const source = match[1] || match[2].split(',')[0].trim();
      const imports = match[2].split(',').map(s => s.trim());
      
      analysis.imports.push({
        source,
        imports,
        alias: match[3],
        isRelative: source.startsWith('.')
      });
      
      if (source.startsWith('.')) {
        analysis.dependencies.add(source);
      }
    }
    
    // Extract functions
    const functionRegex = /^def\s+(\w+)\s*\([^)]*\):/gm;
    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1];
      analysis.functions.push({
        name,
        line: content.substring(0, match.index).split('\n').length
      });
      analysis.symbols.add(name);
      
      // Top-level functions are exports
      if (match.index === 0 || content.substring(0, match.index).match(/^\s*$/)) {
        analysis.exports.push({ name, type: 'function' });
      }
    }
    
    // Extract classes
    const classRegex = /^class\s+(\w+)(?:\(([^)]+)\))?:/gm;
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[1];
      analysis.classes.push({
        name,
        bases: match[2] ? match[2].split(',').map(s => s.trim()) : [],
        line: content.substring(0, match.index).split('\n').length
      });
      analysis.symbols.add(name);
      analysis.exports.push({ name, type: 'class' });
    }
    
    // Detect test file
    analysis.isTest = this.isTestFile(filePath, content);
    
    // Detect framework
    analysis.framework = this.detectPythonFramework(content, analysis.imports);
    
    return analysis;
  }
  
  /**
   * Analyze Go files
   */
  analyzeGo(content, filePath) {
    const analysis = {
      package: '',
      imports: [],
      exports: [],
      functions: [],
      types: [],
      dependencies: new Set(),
      symbols: new Set()
    };
    
    // Extract package name
    const packageMatch = content.match(/^package\s+(\w+)/m);
    if (packageMatch) {
      analysis.package = packageMatch[1];
    }
    
    // Extract imports
    const importRegex = /import\s+(?:\(\s*([\s\S]*?)\s*\)|"([^"]+)")/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) {
        // Multi-line imports
        const imports = match[1].match(/"[^"]+"/g) || [];
        imports.forEach(imp => {
          const importPath = imp.replace(/"/g, '');
          analysis.imports.push({
            path: importPath,
            isStdLib: !importPath.includes('/')
          });
        });
      } else if (match[2]) {
        // Single import
        analysis.imports.push({
          path: match[2],
          isStdLib: !match[2].includes('/')
        });
      }
    }
    
    // Extract functions
    const functionRegex = /func\s+(?:\(.*?\)\s+)?(\w+)\s*\([^)]*\)/g;
    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1];
      const isExported = /^[A-Z]/.test(name);
      
      analysis.functions.push({
        name,
        isExported,
        line: content.substring(0, match.index).split('\n').length
      });
      
      analysis.symbols.add(name);
      if (isExported) {
        analysis.exports.push({ name, type: 'function' });
      }
    }
    
    // Extract types
    const typeRegex = /type\s+(\w+)\s+(?:struct|interface|[\w\[\]]+)/g;
    while ((match = typeRegex.exec(content)) !== null) {
      const name = match[1];
      const isExported = /^[A-Z]/.test(name);
      
      analysis.types.push({
        name,
        isExported,
        line: content.substring(0, match.index).split('\n').length
      });
      
      analysis.symbols.add(name);
      if (isExported) {
        analysis.exports.push({ name, type: 'type' });
      }
    }
    
    // Detect test file
    analysis.isTest = filePath.endsWith('_test.go');
    
    return analysis;
  }
  
  /**
   * Analyze Rust files
   */
  analyzeRust(content, filePath) {
    const analysis = {
      imports: [],
      exports: [],
      functions: [],
      structs: [],
      enums: [],
      traits: [],
      dependencies: new Set(),
      symbols: new Set()
    };
    
    // Extract use statements
    const useRegex = /use\s+([\w:]+)(?:::(\{[^}]+\}|\*))?/g;
    let match;
    while ((match = useRegex.exec(content)) !== null) {
      analysis.imports.push({
        path: match[1],
        items: match[2] || null
      });
    }
    
    // Extract functions
    const functionRegex = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)/g;
    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1];
      const isPublic = content.substring(match.index - 10, match.index).includes('pub');
      
      analysis.functions.push({
        name,
        isPublic,
        line: content.substring(0, match.index).split('\n').length
      });
      
      analysis.symbols.add(name);
      if (isPublic) {
        analysis.exports.push({ name, type: 'function' });
      }
    }
    
    // Extract structs
    const structRegex = /(?:pub\s+)?struct\s+(\w+)/g;
    while ((match = structRegex.exec(content)) !== null) {
      const name = match[1];
      const isPublic = content.substring(match.index - 10, match.index).includes('pub');
      
      analysis.structs.push({ name, isPublic });
      analysis.symbols.add(name);
      if (isPublic) {
        analysis.exports.push({ name, type: 'struct' });
      }
    }
    
    // Detect test module
    analysis.isTest = content.includes('#[cfg(test)]') || content.includes('#[test]');
    
    return analysis;
  }
  
  /**
   * Generic analysis for other file types
   */
  analyzeGeneric(content, filePath) {
    const analysis = {
      imports: [],
      exports: [],
      symbols: new Set(),
      isTest: this.isTestFile(filePath, content)
    };
    
    // Try to detect common patterns
    const lines = content.split('\n');
    
    // Look for import-like statements
    lines.forEach(line => {
      if (line.match(/(?:import|include|require|using)\s+['"<]?([^'">]+)/)) {
        analysis.imports.push({ source: RegExp.$1 });
      }
    });
    
    return analysis;
  }
  
  /**
   * Find files related to the given file
   */
  async findRelatedFiles(targetFile) {
    const analysis = await this.analyzeFile(targetFile);
    if (!analysis) return [];
    
    const related = new Set();
    const projectRoot = this.findProjectRoot(targetFile);
    
    // Add direct dependencies
    for (const dep of analysis.dependencies) {
      const extensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', ''];
      for (const ext of extensions) {
        const depPath = dep.endsWith(ext) ? dep : dep + ext;
        try {
          await fs.access(depPath);
          related.add(depPath);
          break;
        } catch (e) {
          // Try index file
          try {
            const indexPath = path.join(dep, `index${ext}`);
            await fs.access(indexPath);
            related.add(indexPath);
            break;
          } catch (e) {
            // Not found
          }
        }
      }
    }
    
    // Add test files
    if (!analysis.isTest) {
      const testPatterns = [
        targetFile.replace(/\.(js|ts|jsx|tsx)$/, '.test.$1'),
        targetFile.replace(/\.(js|ts|jsx|tsx)$/, '.spec.$1'),
        path.join(path.dirname(targetFile), '__tests__', path.basename(targetFile)),
        targetFile.replace(/\.py$/, '_test.py'),
        targetFile.replace(/\.go$/, '_test.go')
      ];
      
      for (const testPath of testPatterns) {
        try {
          await fs.access(testPath);
          related.add(testPath);
        } catch (e) {
          // Not found
        }
      }
    }
    
    // Add implementation file if this is a test
    if (analysis.isTest) {
      const implPatterns = [
        targetFile.replace(/\.(test|spec)\.(js|ts|jsx|tsx)$/, '.$2'),
        targetFile.replace(/__tests__[\/\\]/, ''),
        targetFile.replace(/_test\.(py|go)$/, '.$1')
      ];
      
      for (const implPath of implPatterns) {
        try {
          await fs.access(implPath);
          related.add(implPath);
        } catch (e) {
          // Not found
        }
      }
    }
    
    // Add related style files for components
    if (targetFile.match(/\.(jsx|tsx)$/)) {
      const stylePatterns = [
        targetFile.replace(/\.(jsx|tsx)$/, '.css'),
        targetFile.replace(/\.(jsx|tsx)$/, '.scss'),
        targetFile.replace(/\.(jsx|tsx)$/, '.less'),
        targetFile.replace(/\.(jsx|tsx)$/, '.module.css'),
        targetFile.replace(/\.(jsx|tsx)$/, '.module.scss')
      ];
      
      for (const stylePath of stylePatterns) {
        try {
          await fs.access(stylePath);
          related.add(stylePath);
        } catch (e) {
          // Not found
        }
      }
    }
    
    return Array.from(related);
  }
  
  /**
   * Build dependency graph for a set of files
   */
  async buildDependencyGraph(files) {
    const graph = new Map();
    
    for (const file of files) {
      const analysis = await this.analyzeFile(file);
      if (!analysis) continue;
      
      const dependencies = await this.findRelatedFiles(file);
      graph.set(file, {
        analysis,
        dependencies: dependencies.filter(dep => files.includes(dep)),
        dependents: []
      });
    }
    
    // Build reverse dependencies
    for (const [file, node] of graph) {
      for (const dep of node.dependencies) {
        const depNode = graph.get(dep);
        if (depNode) {
          depNode.dependents.push(file);
        }
      }
    }
    
    this.dependencyGraph = graph;
    return graph;
  }
  
  /**
   * Find project root
   */
  findProjectRoot(filePath) {
    let dir = path.dirname(filePath);
    
    while (dir !== path.dirname(dir)) {
      try {
        // Check for common project indicators
        const indicators = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', '.git'];
        for (const indicator of indicators) {
          if (require('fs').existsSync(path.join(dir, indicator))) {
            return dir;
          }
        }
      } catch (e) {
        // Continue searching
      }
      dir = path.dirname(dir);
    }
    
    return path.dirname(filePath);
  }
  
  /**
   * Check if file is a test file
   */
  isTestFile(filePath, content) {
    // File name patterns
    if (filePath.match(/\.(test|spec)\.(js|ts|jsx|tsx)$/) ||
        filePath.includes('__tests__') ||
        filePath.match(/_test\.(py|go)$/) ||
        filePath.includes('/test/') ||
        filePath.includes('/tests/')) {
      return true;
    }
    
    // Content patterns
    const testPatterns = [
      /describe\s*\(/,
      /test\s*\(/,
      /it\s*\(/,
      /@Test/,
      /def test_/,
      /func Test/,
      /#\[test\]/,
      /#\[cfg\(test\)\]/
    ];
    
    return testPatterns.some(pattern => pattern.test(content));
  }
  
  /**
   * Detect JavaScript framework
   */
  detectJavaScriptFramework(content, imports) {
    const frameworks = {
      react: ['react', 'react-dom'],
      vue: ['vue', '@vue'],
      angular: ['@angular/core'],
      express: ['express'],
      next: ['next', 'next/'],
      nuxt: ['nuxt', '@nuxt'],
      svelte: ['svelte'],
      ember: ['ember'],
      nest: ['@nestjs/core']
    };
    
    for (const [framework, indicators] of Object.entries(frameworks)) {
      if (imports.some(imp => indicators.some(ind => imp.source.includes(ind)))) {
        return framework;
      }
    }
    
    return null;
  }
  
  /**
   * Detect Python framework
   */
  detectPythonFramework(content, imports) {
    const frameworks = {
      django: ['django'],
      flask: ['flask'],
      fastapi: ['fastapi'],
      pytest: ['pytest'],
      numpy: ['numpy'],
      pandas: ['pandas'],
      tensorflow: ['tensorflow'],
      pytorch: ['torch']
    };
    
    for (const [framework, indicators] of Object.entries(frameworks)) {
      if (imports.some(imp => indicators.some(ind => imp.source.includes(ind)))) {
        return framework;
      }
    }
    
    return null;
  }
}

module.exports = SemanticAnalyzer;