class UniversalRedactor {
  constructor() {
    this.patterns = [
      { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replace: '[EMAIL]' },
      { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replace: '[SSN]' },
      { regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replace: '[CARD]' },
      { regex: /Bearer\s+[A-Za-z0-9\-._~\+\/]+=*/g, replace: 'Bearer [TOKEN]' },
      { regex: /sk_[A-Za-z0-9]{32,}/g, replace: '[STRIPE_KEY]' },
      { regex: /ghp_[A-Za-z0-9]{36}/g, replace: '[GITHUB_TOKEN]' },
      { regex: /https?:\/\/[^:]+:[^@]+@/g, replace: 'https://[CREDS]@' },
      { regex: /[A-Z0-9]{20,}/g, replace: '[REDACTED_KEY]' }
    ];
  }

  redact(text) {
    if (typeof text !== 'string') return text;
    
    let redacted = text;
    for (const pattern of this.patterns) {
      redacted = redacted.replace(pattern.regex, pattern.replace);
    }
    return redacted;
  }

  redactForLog(data) {
    if (typeof data === 'string') {
      return this.redact(data);
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.redactForLog(item));
    }
    
    if (typeof data === 'object' && data !== null) {
      const redacted = {};
      for (const key in data) {
        redacted[key] = this.redactForLog(data[key]);
      }
      return redacted;
    }
    
    return data;
  }
}

module.exports = UniversalRedactor;