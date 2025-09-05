/**
 * ETag Manager - Version control and conflict detection
 */

const crypto = require('crypto');

class ETagManager {
  constructor() {
    this.counter = 0;
    this.etags = new Map(); // slug -> current etag
  }

  /**
   * Generate new ETag
   */
  generate(slug) {
    const timestamp = Date.now();
    this.counter++;
    const etag = `v${timestamp}-${this.counter}`;
    this.etags.set(slug, etag);
    return etag;
  }

  /**
   * Validate provided ETag matches current
   */
  validate(slug, provided) {
    const current = this.etags.get(slug);
    if (!current) {
      // First operation, any etag is valid
      return true;
    }
    return provided === current;
  }

  /**
   * Get current ETag for slug
   */
  getCurrent(slug) {
    return this.etags.get(slug);
  }

  /**
   * Increment and return new ETag
   */
  increment(slug) {
    return this.generate(slug);
  }

  /**
   * Generate content hash for verification
   */
  hash(content) {
    return crypto.createHash('sha256')
      .update(content, 'utf8')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Store hash with ETag for later verification
   */
  storeHash(slug, etag, contentHash) {
    const key = `${slug}:${etag}`;
    this.etags.set(key, contentHash);
  }

  /**
   * Verify content hash matches stored
   */
  verifyHash(slug, etag, content) {
    const key = `${slug}:${etag}`;
    const storedHash = this.etags.get(key);
    const currentHash = this.hash(content);
    return storedHash === currentHash;
  }
}

module.exports = ETagManager;