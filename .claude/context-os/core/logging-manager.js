#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');

/**
 * Logging Manager - Comprehensive logging with rotation and search
 */
class LoggingManager {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.logsDir = path.join(contextRoot, 'logs');
    this.streams = new Map();
    this.config = {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      logLevels: ['error', 'warn', 'info', 'debug', 'trace'],
      defaultLevel: 'info',
      timestampFormat: 'ISO', // ISO, unix, custom
      includeMetadata: true,
      asyncFlush: true,
      compression: false
    };
  }

  async initialize() {
    await fs.mkdir(this.logsDir, { recursive: true });
    
    // Create default log categories
    const categories = [
      'context',      // Context loading/switching
      'knowledge',    // Knowledge operations
      'security',     // Security events
      'team',         // Team sync operations
      'automation',   // Automated actions
      'performance',  // Performance metrics
      'errors'        // Error tracking
    ];
    
    for (const category of categories) {
      await fs.mkdir(path.join(this.logsDir, category), { recursive: true });
    }
  }

  /**
   * Log an event
   */
  async log(category, level, message, data = {}) {
    if (!this.isValidLevel(level)) {
      throw new Error(`Invalid log level: ${level}`);
    }
    
    const logEntry = {
      timestamp: this.getTimestamp(),
      level,
      message,
      category,
      pid: process.pid,
      hostname: require('os').hostname(),
      user: process.env.USER || process.env.USERNAME || 'unknown',
      ...data
    };
    
    // Add stack trace for errors
    if (level === 'error' && data.error) {
      logEntry.stack = data.error.stack;
      logEntry.errorType = data.error.constructor.name;
    }
    
    // Write to category log
    await this.writeToLog(category, logEntry);
    
    // Also write errors to main error log
    if (level === 'error') {
      await this.writeToLog('errors', logEntry);
    }
    
    // Console output for important messages
    if (this.shouldConsoleLog(level)) {
      this.consoleLog(level, category, message);
    }
    
    return logEntry;
  }

  /**
   * Write to log file with rotation
   */
  async writeToLog(category, entry) {
    const logFile = await this.getLogFile(category);
    const logLine = JSON.stringify(entry) + '\n';
    
    // Check if rotation needed
    try {
      const stats = await fs.stat(logFile);
      if (stats.size > this.config.maxFileSize) {
        await this.rotateLog(category, logFile);
      }
    } catch {
      // File doesn't exist yet
    }
    
    // Write to file
    if (this.config.asyncFlush) {
      // Use stream for better performance
      const stream = await this.getStream(logFile);
      stream.write(logLine);
    } else {
      // Direct write
      await fs.appendFile(logFile, logLine);
    }
  }

  /**
   * Get or create write stream
   */
  async getStream(logFile) {
    if (!this.streams.has(logFile)) {
      const stream = createWriteStream(logFile, { flags: 'a' });
      this.streams.set(logFile, stream);
      
      // Auto-close streams after inactivity
      stream.timeout = setTimeout(() => {
        stream.end();
        this.streams.delete(logFile);
      }, 60000); // 1 minute
    }
    
    const stream = this.streams.get(logFile);
    clearTimeout(stream.timeout);
    stream.timeout = setTimeout(() => {
      stream.end();
      this.streams.delete(logFile);
    }, 60000);
    
    return stream;
  }

  /**
   * Get current log file path
   */
  async getLogFile(category) {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logsDir, category, `${date}.log`);
  }

  /**
   * Rotate log file
   */
  async rotateLog(category, logFile) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedFile = logFile.replace('.log', `.${timestamp}.log`);
    
    // Close stream if exists
    const stream = this.streams.get(logFile);
    if (stream) {
      stream.end();
      this.streams.delete(logFile);
    }
    
    // Rename file
    await fs.rename(logFile, rotatedFile);
    
    // Compress if configured
    if (this.config.compression) {
      await this.compressLog(rotatedFile);
    }
    
    // Clean up old files
    await this.cleanupOldLogs(category);
  }

  /**
   * Compress log file (stub for now)
   */
  async compressLog(logFile) {
    // TODO: Implement compression using zlib
    // For now, just rename with .gz extension
    // const zlib = require('zlib');
    // const gzip = zlib.createGzip();
    // ...
  }

  /**
   * Clean up old log files
   */
  async cleanupOldLogs(category) {
    const logDir = path.join(this.logsDir, category);
    const files = await fs.readdir(logDir);
    
    // Get all log files sorted by date
    const logFiles = files
      .filter(f => f.endsWith('.log') || f.endsWith('.log.gz'))
      .sort()
      .reverse();
    
    // Remove old files
    for (let i = this.config.maxFiles; i < logFiles.length; i++) {
      await fs.unlink(path.join(logDir, logFiles[i]));
    }
  }

  /**
   * Search logs
   */
  async search(options = {}) {
    const {
      category = null,
      level = null,
      startDate = null,
      endDate = null,
      pattern = null,
      limit = 100,
      user = null
    } = options;
    
    const results = [];
    const categories = category ? [category] : await this.getCategories();
    
    for (const cat of categories) {
      const logFiles = await this.getLogFiles(cat, startDate, endDate);
      
      for (const logFile of logFiles) {
        const entries = await this.searchLogFile(logFile, {
          level,
          pattern,
          user,
          limit: limit - results.length
        });
        
        results.push(...entries);
        
        if (results.length >= limit) {
          break;
        }
      }
      
      if (results.length >= limit) {
        break;
      }
    }
    
    return results;
  }

  /**
   * Search a single log file
   */
  async searchLogFile(logFile, filters) {
    const results = [];
    
    try {
      const content = await fs.readFile(logFile, 'utf8');
      const lines = content.trim().split('\n');
      
      for (const line of lines) {
        if (results.length >= filters.limit) break;
        
        try {
          const entry = JSON.parse(line);
          
          // Apply filters
          if (filters.level && entry.level !== filters.level) continue;
          if (filters.user && entry.user !== filters.user) continue;
          if (filters.pattern) {
            const regex = new RegExp(filters.pattern, 'i');
            if (!regex.test(entry.message) && !regex.test(JSON.stringify(entry))) {
              continue;
            }
          }
          
          results.push(entry);
        } catch {
          // Invalid JSON line, skip
        }
      }
    } catch {
      // File doesn't exist or can't be read
    }
    
    return results;
  }

  /**
   * Get log files for date range
   */
  async getLogFiles(category, startDate, endDate) {
    const logDir = path.join(this.logsDir, category);
    
    try {
      const files = await fs.readdir(logDir);
      return files
        .filter(f => f.endsWith('.log'))
        .filter(f => {
          const fileDate = f.replace('.log', '');
          if (startDate && fileDate < startDate) return false;
          if (endDate && fileDate > endDate) return false;
          return true;
        })
        .map(f => path.join(logDir, f));
    } catch {
      return [];
    }
  }

  /**
   * Get all categories
   */
  async getCategories() {
    const dirs = await fs.readdir(this.logsDir);
    const categories = [];
    
    for (const dir of dirs) {
      const stat = await fs.stat(path.join(this.logsDir, dir));
      if (stat.isDirectory()) {
        categories.push(dir);
      }
    }
    
    return categories;
  }

  /**
   * Get timestamp
   */
  getTimestamp() {
    switch (this.config.timestampFormat) {
      case 'unix':
        return Date.now();
      case 'ISO':
      default:
        return new Date().toISOString();
    }
  }

  /**
   * Check if level is valid
   */
  isValidLevel(level) {
    return this.config.logLevels.includes(level);
  }

  /**
   * Check if should log to console
   */
  shouldConsoleLog(level) {
    const levelIndex = this.config.logLevels.indexOf(level);
    const defaultIndex = this.config.logLevels.indexOf(this.config.defaultLevel);
    return levelIndex <= defaultIndex;
  }

  /**
   * Console log with formatting
   */
  consoleLog(level, category, message) {
    const colors = {
      error: '\x1b[31m',   // Red
      warn: '\x1b[33m',    // Yellow
      info: '\x1b[36m',    // Cyan
      debug: '\x1b[90m',   // Gray
      trace: '\x1b[90m'    // Gray
    };
    
    const reset = '\x1b[0m';
    const color = colors[level] || '';
    
    console.log(`${color}[${level.toUpperCase()}]${reset} [${category}] ${message}`);
  }

  /**
   * Get log statistics
   */
  async getStats(category = null) {
    const stats = {
      categories: {},
      totalSize: 0,
      totalEntries: 0,
      oldestEntry: null,
      newestEntry: null,
      byLevel: {},
      byUser: {}
    };
    
    const categories = category ? [category] : await this.getCategories();
    
    for (const cat of categories) {
      const catStats = {
        files: 0,
        size: 0,
        entries: 0
      };
      
      const logDir = path.join(this.logsDir, cat);
      const files = await fs.readdir(logDir).catch(() => []);
      
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        
        const filePath = path.join(logDir, file);
        const fileStat = await fs.stat(filePath);
        
        catStats.files++;
        catStats.size += fileStat.size;
        stats.totalSize += fileStat.size;
        
        // Sample first and last entries
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.trim().split('\n').filter(l => l);
          
          catStats.entries += lines.length;
          stats.totalEntries += lines.length;
          
          if (lines.length > 0) {
            const firstEntry = JSON.parse(lines[0]);
            const lastEntry = JSON.parse(lines[lines.length - 1]);
            
            if (!stats.oldestEntry || firstEntry.timestamp < stats.oldestEntry.timestamp) {
              stats.oldestEntry = firstEntry;
            }
            
            if (!stats.newestEntry || lastEntry.timestamp > stats.newestEntry.timestamp) {
              stats.newestEntry = lastEntry;
            }
          }
        } catch {
          // Skip invalid files
        }
      }
      
      stats.categories[cat] = catStats;
    }
    
    return stats;
  }

  /**
   * Clean up old logs across all categories
   */
  async cleanup(daysToKeep = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    let cleaned = 0;
    const categories = await this.getCategories();
    
    for (const category of categories) {
      const logDir = path.join(this.logsDir, category);
      const files = await fs.readdir(logDir).catch(() => []);
      
      for (const file of files) {
        if (!file.endsWith('.log') && !file.endsWith('.log.gz')) continue;
        
        const fileDate = file.split('.')[0];
        if (fileDate < cutoffStr) {
          await fs.unlink(path.join(logDir, file));
          cleaned++;
        }
      }
    }
    
    await this.log('maintenance', 'info', `Cleaned up ${cleaned} old log files`, {
      daysToKeep,
      cutoffDate: cutoffStr
    });
    
    return cleaned;
  }

  /**
   * Close all streams
   */
  async close() {
    for (const [file, stream] of this.streams) {
      clearTimeout(stream.timeout);
      stream.end();
    }
    this.streams.clear();
  }
}

// Singleton instance
let instance = null;

function getLogger(contextRoot) {
  if (!instance) {
    instance = new LoggingManager(contextRoot);
  }
  return instance;
}

module.exports = { LoggingManager, getLogger };

// CLI interface
if (require.main === module) {
  const manager = new LoggingManager(path.join(__dirname, '..'));
  
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  (async () => {
    await manager.initialize();
    
    switch (command) {
      case 'search':
        const pattern = args[0];
        if (!pattern) {
          console.log('Usage: logging-manager search <pattern> [category]');
          process.exit(1);
        }
        
        const results = await manager.search({
          pattern,
          category: args[1],
          limit: 50
        });
        
        console.log(`Found ${results.length} matches:\n`);
        results.forEach(entry => {
          console.log(`[${entry.timestamp}] [${entry.level}] ${entry.message}`);
        });
        break;
        
      case 'stats':
        const stats = await manager.getStats(args[0]);
        console.log('Log Statistics:');
        console.log(`Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Total entries: ${stats.totalEntries}`);
        
        if (stats.oldestEntry) {
          console.log(`Oldest: ${stats.oldestEntry.timestamp}`);
        }
        if (stats.newestEntry) {
          console.log(`Newest: ${stats.newestEntry.timestamp}`);
        }
        
        console.log('\nBy category:');
        Object.entries(stats.categories).forEach(([cat, catStats]) => {
          console.log(`  ${cat}: ${catStats.entries} entries, ${catStats.files} files`);
        });
        break;
        
      case 'cleanup':
        const days = parseInt(args[0]) || 30;
        const cleaned = await manager.cleanup(days);
        console.log(`Cleaned up ${cleaned} old log files`);
        break;
        
      case 'tail':
        const category = args[0] || 'context';
        const logFile = await manager.getLogFile(category);
        
        console.log(`Tailing ${category} logs...`);
        
        // Simple tail implementation
        const { spawn } = require('child_process');
        const tail = spawn('tail', ['-f', logFile]);
        
        tail.stdout.on('data', (data) => {
          const lines = data.toString().trim().split('\n');
          lines.forEach(line => {
            try {
              const entry = JSON.parse(line);
              manager.consoleLog(entry.level, entry.category, entry.message);
            } catch {
              console.log(line);
            }
          });
        });
        
        tail.on('error', (err) => {
          console.error('Tail command not available');
        });
        break;
        
      default:
        console.log('Usage: logging-manager [search|stats|cleanup|tail]');
    }
    
    await manager.close();
  })();
}