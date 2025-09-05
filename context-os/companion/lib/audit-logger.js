const fs = require('fs');
const path = require('path');
const UniversalRedactor = require('./redactor');

class AuditLogger {
  constructor(sessionManager) {
    this.session = sessionManager;
    this.redactor = new UniversalRedactor();
    this.logPath = '.logs/context-os-companion.jsonl';
    this.ensureLogDir();
  }

  ensureLogDir() {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log(action, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...this.session.getContext(),
      ...this.redactor.redactForLog(data)
    };
    
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    return entry;
  }

  async getRecent(limit = 100) {
    try {
      const content = fs.readFileSync(this.logPath, 'utf8');
      const lines = content.trim().split('\n');
      return lines
        .slice(-limit)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  async rotate() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = `${this.logPath}.${timestamp}`;
    
    try {
      fs.renameSync(this.logPath, archivePath);
      this.ensureLogDir();
      
      // Compress old log
      const { exec } = require('child_process');
      exec(`gzip ${archivePath}`);
      
      return archivePath;
    } catch (error) {
      console.error('Failed to rotate logs:', error);
      return null;
    }
  }
}

module.exports = AuditLogger;