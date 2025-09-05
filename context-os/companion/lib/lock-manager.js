const fs = require('fs').promises;
const path = require('path');

class LockManager {
  constructor(auditLogger) {
    this.locks = new Map();
    this.lockDir = '.tmp/locks';
    this.audit = auditLogger;
    this.timeout = 30000; // 30s
    this.init();
  }

  async init() {
    await fs.mkdir(this.lockDir, { recursive: true });
  }

  async acquireLock(slug, userId, sessionId) {
    const lockFile = path.join(this.lockDir, `${slug}.lock`);
    
    try {
      const existing = JSON.parse(await fs.readFile(lockFile, 'utf8'));
      const age = Date.now() - existing.timestamp;
      
      if (age < this.timeout && existing.sessionId !== sessionId) {
        this.audit.log('lock_conflict', { slug, owner: existing.userId, age });
        return {
          acquired: false,
          owner: existing.userId,
          message: `${existing.userId} is editing (${Math.floor(age/1000)}s ago)`
        };
      }
    } catch {
      // No lock exists
    }
    
    const lock = { userId, sessionId, timestamp: Date.now() };
    await fs.writeFile(lockFile, JSON.stringify(lock));
    this.locks.set(slug, lock);
    
    // Auto-release timer
    const timer = setTimeout(() => {
      this.releaseLock(slug, sessionId);
    }, this.timeout);
    
    lock.timer = timer;
    this.audit.log('lock_acquired', { slug });
    
    return { acquired: true };
  }

  async releaseLock(slug, sessionId) {
    const lock = this.locks.get(slug);
    if (lock?.sessionId === sessionId) {
      clearTimeout(lock.timer);
      this.locks.delete(slug);
      
      const lockFile = path.join(this.lockDir, `${slug}.lock`);
      await fs.unlink(lockFile).catch(() => {});
      
      this.audit.log('lock_released', { slug });
    }
  }

  async refreshLock(slug, sessionId) {
    const lock = this.locks.get(slug);
    if (lock?.sessionId === sessionId) {
      lock.timestamp = Date.now();
      clearTimeout(lock.timer);
      
      lock.timer = setTimeout(() => {
        this.releaseLock(slug, sessionId);
      }, this.timeout);
      
      const lockFile = path.join(this.lockDir, `${slug}.lock`);
      await fs.writeFile(lockFile, JSON.stringify({
        userId: lock.userId,
        sessionId: lock.sessionId,
        timestamp: lock.timestamp
      }));
    }
  }

  async getLockStatus(slug) {
    const lockFile = path.join(this.lockDir, `${slug}.lock`);
    
    try {
      const lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
      const age = Date.now() - lock.timestamp;
      
      if (age > this.timeout) {
        await fs.unlink(lockFile).catch(() => {});
        return null;
      }
      
      return lock;
    } catch {
      return null;
    }
  }
}

module.exports = LockManager;