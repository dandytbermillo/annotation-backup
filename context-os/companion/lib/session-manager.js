const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

class SessionManager {
  constructor() {
    this.sessionId = uuidv4();
    this.userId = this.getOrCreateUserId();
    this.startTime = Date.now();
  }

  getOrCreateUserId() {
    const userFile = path.join(os.homedir(), '.context-os', 'user.json');
    
    try {
      const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
      return data.userId;
    } catch {
      const userId = `user_${os.hostname()}_${Date.now()}`;
      const userDir = path.dirname(userFile);
      
      fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(userFile, JSON.stringify({
        userId,
        created: new Date().toISOString(),
        hostname: os.hostname()
      }));
      
      return userId;
    }
  }

  getContext() {
    return {
      userId: this.userId,
      sessionId: this.sessionId,
      hostname: os.hostname(),
      pid: process.pid,
      uptime: Date.now() - this.startTime
    };
  }
}

module.exports = SessionManager;