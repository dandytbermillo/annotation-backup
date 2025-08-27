#!/usr/bin/env node

const path = require('path');

/**
 * Context Compressor - Intelligently compresses code files to fit more in token budget
 */
class ContextCompressor {
  compressFile(content, filePath) {
    const ext = path.extname(filePath);
    
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      return this.compressJavaScript(content);
    } else if (['.py'].includes(ext)) {
      return this.compressPython(content);
    } else if (['.go'].includes(ext)) {
      return this.compressGo(content);
    } else if (['.rs'].includes(ext)) {
      return this.compressRust(content);
    }
    
    return content; // No compression for other files
  }
  
  compressJavaScript(content) {
    const lines = content.split('\n');
    const compressed = [];
    let inImplementation = false;
    let bracketDepth = 0;
    let inMultilineComment = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Handle multiline comments
      if (line.includes('/*') && !line.includes('*/')) {
        inMultilineComment = true;
        compressed.push(line);
        continue;
      }
      if (inMultilineComment) {
        compressed.push(line);
        if (line.includes('*/')) {
          inMultilineComment = false;
        }
        continue;
      }
      
      // Always keep imports, exports, and type definitions
      if (line.match(/^(import|export|type\s+|interface\s+|declare\s+)/)) {
        compressed.push(line);
        continue;
      }
      
      // Keep JSDoc comments
      if (trimmed.startsWith('/**') || trimmed.startsWith('*')) {
        compressed.push(line);
        continue;
      }
      
      // Keep function/class signatures
      const funcMatch = line.match(/^(\s*)(export\s+)?(async\s+)?(function\s+\w+|class\s+\w+|const\s+\w+\s*=\s*(async\s*)?(\([^)]*\)\s*=>|\([^)]*\)\s*:\s*\w+\s*=>|function))/);
      if (funcMatch) {
        compressed.push(line);
        const indent = funcMatch[1] || '';
        
        // Check if it's a one-liner
        if (line.includes('{') && line.includes('}')) {
          continue;
        }
        
        inImplementation = true;
        bracketDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        
        // Add implementation placeholder
        if (bracketDepth > 0) {
          compressed.push(indent + '  // ... implementation ...');
        }
        continue;
      }
      
      // Track brackets to know when implementation ends
      if (inImplementation) {
        bracketDepth += (line.match(/{/g) || []).length;
        bracketDepth -= (line.match(/}/g) || []).length;
        
        if (bracketDepth <= 0) {
          compressed.push(line);
          inImplementation = false;
        }
      } else {
        // Keep top-level code, comments, and decorators
        if (trimmed.startsWith('//') || trimmed.startsWith('@') || trimmed === '' || !trimmed.includes('{')) {
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
    let inClass = false;
    let functionIndent = 0;
    let classIndent = 0;
    let inDocstring = false;
    let docstringQuotes = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const indent = line.search(/\S/);
      const trimmed = line.trim();
      
      // Handle docstrings
      if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        docstringQuotes = trimmed.substring(0, 3);
        if (trimmed.endsWith(docstringQuotes) && trimmed.length > 6) {
          compressed.push(line);
        } else {
          inDocstring = !inDocstring;
          compressed.push(line);
        }
        continue;
      }
      
      if (inDocstring) {
        compressed.push(line);
        if (trimmed.endsWith(docstringQuotes)) {
          inDocstring = false;
        }
        continue;
      }
      
      // Keep imports and decorators
      if (line.match(/^(import|from|@)/)) {
        compressed.push(line);
        continue;
      }
      
      // Keep class definitions
      if (trimmed.startsWith('class ')) {
        compressed.push(line);
        inClass = true;
        classIndent = indent;
        continue;
      }
      
      // Keep function signatures
      if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
        compressed.push(line);
        // Add docstring placeholder if next line is not a docstring
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (!nextLine.startsWith('"""') && !nextLine.startsWith("'''")) {
            compressed.push(' '.repeat(indent + 4) + '"""..."""');
          }
        }
        inFunction = true;
        functionIndent = indent;
        continue;
      }
      
      // Skip function implementation
      if (inFunction && indent > functionIndent) {
        continue;
      } else if (inFunction && indent <= functionIndent) {
        inFunction = false;
      }
      
      // Keep class-level attributes and methods signatures
      if (inClass && indent === classIndent + 4 && !inFunction) {
        if (trimmed && !trimmed.startsWith('def ')) {
          compressed.push(line);
        }
      }
      
      // Keep module-level code
      if (indent === 0 || trimmed.startsWith('#')) {
        compressed.push(line);
      }
    }
    
    return compressed.join('\n');
  }
  
  compressGo(content) {
    const lines = content.split('\n');
    const compressed = [];
    let inFunction = false;
    let bracketDepth = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Keep package, imports, and type definitions
      if (line.match(/^(package|import|type\s+|const\s+|var\s+)/)) {
        compressed.push(line);
        continue;
      }
      
      // Keep comments
      if (trimmed.startsWith('//')) {
        compressed.push(line);
        continue;
      }
      
      // Keep function signatures
      if (line.match(/^func\s+/)) {
        compressed.push(line);
        inFunction = true;
        bracketDepth = (line.match(/{/g) || []).length;
        
        if (bracketDepth > 0 && !line.includes('}')) {
          compressed.push('    // ... implementation ...');
        }
        continue;
      }
      
      // Track implementation
      if (inFunction) {
        bracketDepth += (line.match(/{/g) || []).length;
        bracketDepth -= (line.match(/}/g) || []).length;
        
        if (bracketDepth <= 0) {
          compressed.push(line);
          inFunction = false;
        }
      } else {
        compressed.push(line);
      }
    }
    
    return compressed.join('\n');
  }
  
  compressRust(content) {
    const lines = content.split('\n');
    const compressed = [];
    let inFunction = false;
    let bracketDepth = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Keep use statements, mods, and type definitions
      if (line.match(/^(use\s+|mod\s+|pub\s+mod|struct\s+|enum\s+|trait\s+|impl\s+|type\s+)/)) {
        compressed.push(line);
        continue;
      }
      
      // Keep attributes and comments
      if (trimmed.startsWith('#[') || trimmed.startsWith('//')) {
        compressed.push(line);
        continue;
      }
      
      // Keep function signatures
      if (line.match(/^\s*(pub\s+)?(async\s+)?fn\s+/)) {
        compressed.push(line);
        inFunction = true;
        bracketDepth = (line.match(/{/g) || []).length;
        
        if (bracketDepth > 0 && !line.includes('}')) {
          compressed.push('    // ... implementation ...');
        }
        continue;
      }
      
      // Track implementation
      if (inFunction) {
        bracketDepth += (line.match(/{/g) || []).length;
        bracketDepth -= (line.match(/}/g) || []).length;
        
        if (bracketDepth <= 0) {
          compressed.push(line);
          inFunction = false;
        }
      } else {
        compressed.push(line);
      }
    }
    
    return compressed.join('\n');
  }
  
  /**
   * Estimate compression ratio for a file
   */
  estimateCompressionRatio(filePath) {
    const ext = path.extname(filePath);
    
    // Based on typical compression ratios
    const ratios = {
      '.js': 0.4,
      '.jsx': 0.4,
      '.ts': 0.45,
      '.tsx': 0.45,
      '.py': 0.35,
      '.go': 0.4,
      '.rs': 0.45,
      '.java': 0.5,
      '.c': 0.6,
      '.cpp': 0.6,
      '.h': 0.3,
      '.hpp': 0.3
    };
    
    return ratios[ext] || 1.0;
  }
}

module.exports = ContextCompressor;