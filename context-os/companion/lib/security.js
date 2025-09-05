const crypto = require('crypto');
const path = require('path');

class SecurityMiddleware {
  constructor() {
    this.csrfTokens = new Map();
    this.rateLimits = new Map();
    this.idempotencyKeys = new Map();
    this.whitelist = ['.tmp/initial/', 'docs/proposal/'];
  }

  generateCSRF() {
    const token = crypto.randomBytes(32).toString('hex');
    this.csrfTokens.set(token, Date.now());
    setTimeout(() => this.csrfTokens.delete(token), 900000); // 15min
    return token;
  }

  validateCSRF(token) {
    return this.csrfTokens.has(token);
  }

  checkOrigin(req) {
    const origin = req.headers.origin || req.headers.referer;
    console.log('Origin check:', origin);
    if (!origin) return false;
    // Allow any localhost origin for development
    return origin.includes('localhost') || origin.includes('127.0.0.1');
  }

  normalizePath(slug) {
    return slug
      .replace(/\.\./g, '')
      .replace(/[^\w-]/g, '_')
      .substring(0, 100);
  }

  isPathAllowed(filepath) {
    const normalized = path.normalize(filepath);
    return this.whitelist.some(dir => normalized.startsWith(dir));
  }

  checkRateLimit(key) {
    const now = Date.now();
    const window = 1000; // 1s
    const limit = 10;
    
    const record = this.rateLimits.get(key) || { count: 0, window: now };
    
    if (now - record.window > window) {
      record.count = 1;
      record.window = now;
    } else {
      record.count++;
    }
    
    this.rateLimits.set(key, record);
    return record.count <= limit;
  }

  checkIdempotency(key) {
    if (this.idempotencyKeys.has(key)) {
      return { duplicate: true, result: this.idempotencyKeys.get(key) };
    }
    return { duplicate: false };
  }

  storeIdempotency(key, result) {
    this.idempotencyKeys.set(key, result);
    setTimeout(() => this.idempotencyKeys.delete(key), 300000); // 5min
  }

  middleware() {
    return (req, res, next) => {
      console.log(`Security check for ${req.method} ${req.path}`);
      console.log('Headers:', req.headers);
      
      // Check origin
      if (!this.checkOrigin(req)) {
        console.log('Origin check failed');
        return res.status(403).json({ error: 'Invalid origin', code: 'INVALID_ORIGIN' });
      }

      // Check CSRF for mutations (disabled temporarily for debugging)
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const token = req.headers['x-csrf-token'];
        console.log('CSRF token provided:', token);
        if (token && !this.validateCSRF(token)) {
          console.log('CSRF validation failed - invalid token');
          // For now, just log but don't block
          console.log('WARNING: Invalid CSRF token, but allowing request for development');
        } else if (!token) {
          console.log('WARNING: No CSRF token provided, allowing for development');
        }
        // Temporarily allow all requests for debugging
        // return res.status(403).json({ error: 'CSRF token required', code: 'CSRF_REQUIRED' });
      }

      // Rate limiting
      const rateLimitKey = `${req.ip}:${req.path}`;
      if (!this.checkRateLimit(rateLimitKey)) {
        return res.status(429).json({ error: 'Rate limited', code: 'RATE_LIMITED' });
      }

      // Idempotency
      const idempotencyKey = req.headers['x-idempotency-key'];
      if (idempotencyKey) {
        const check = this.checkIdempotency(idempotencyKey);
        if (check.duplicate) {
          return res.json(check.result);
        }
        req.idempotencyKey = idempotencyKey;
      }

      next();
    };
  }
}

module.exports = SecurityMiddleware;