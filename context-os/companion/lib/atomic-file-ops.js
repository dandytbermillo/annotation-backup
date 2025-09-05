const fs = require('fs').promises;
const path = require('path');

class AtomicFileOps {
  constructor(auditLogger) {
    this.audit = auditLogger;
    this.backupDir = 'context-os/companion/backups';
    this.maxBackups = 5;
  }

  async write(filepath, content) {
    const temp = `${filepath}.tmp.${Date.now()}`;
    const backup = await this.createBackup(filepath);
    
    try {
      await fs.writeFile(temp, content, 'utf8');
      const fd = await fs.open(temp, 'r+');
      await fd.sync(); // Force to disk
      await fd.close();
      
      await fs.rename(temp, filepath);
      
      this.audit.log('file_write', { 
        path: filepath, 
        backup, 
        size: content.length 
      });
      
      return { success: true, backup };
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      throw error;
    }
  }

  async createBackup(filepath) {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        this.backupDir,
        `${path.basename(filepath)}.bak.${timestamp}`
      );
      
      await fs.mkdir(this.backupDir, { recursive: true });
      await fs.writeFile(backupPath, content, 'utf8');
      
      await this.rotateBackups(filepath);
      return backupPath;
    } catch {
      return null; // File doesn't exist yet
    }
  }

  async rotateBackups(filepath) {
    const basename = path.basename(filepath);
    const files = await fs.readdir(this.backupDir);
    const backups = files
      .filter(f => f.startsWith(`${basename}.bak.`))
      .map(f => ({
        name: f,
        path: path.join(this.backupDir, f),
        time: f.match(/\.bak\.(.+)$/)[1]
      }))
      .sort((a, b) => b.time.localeCompare(a.time));
    
    while (backups.length > this.maxBackups) {
      const old = backups.pop();
      await fs.unlink(old.path);
    }
  }

  async read(filepath) {
    return fs.readFile(filepath, 'utf8');
  }

  async exists(filepath) {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  async ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
  }
}

module.exports = AtomicFileOps;