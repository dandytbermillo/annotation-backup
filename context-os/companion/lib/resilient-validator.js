const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class ResilientValidator {
  constructor(auditLogger) {
    this.audit = auditLogger;
    this.scriptPath = './scripts/validate-doc-structure.sh';
    this.timeout = 5000;
  }

  async validate(slug, content) {
    const tempFile = path.join('.tmp', `${slug}.validate.md`);
    
    try {
      await fs.mkdir('.tmp', { recursive: true });
      await fs.writeFile(tempFile, content, 'utf8');
      
      const result = await this.runWithTimeout(
        `${this.scriptPath} ${tempFile}`,
        this.timeout
      );
      
      const parsed = this.parseOutput(result.stdout, result.stderr, result.code);
      
      if (!parsed.ok) {
        parsed.reason = this.explainFailure(parsed);
      }
      
      this.audit.log('validation', {
        slug,
        result: parsed.ok ? 'pass' : 'fail',
        missing: parsed.missing_fields.length
      });
      
      return parsed;
      
    } catch (error) {
      this.audit.log('validation_error', { slug, error: error.message });
      
      return {
        ok: false,
        missing_fields: ['validator_error'],
        warnings: [],
        reason: `Validator failed: ${error.message}`,
        fallback: true
      };
      
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  runWithTimeout(command, timeout) {
    return new Promise((resolve) => {
      const child = exec(command);
      let stdout = '', stderr = '';
      let timedOut = false;
      
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);
      
      child.stdout.on('data', d => stdout += d);
      child.stderr.on('data', d => stderr += d);
      
      child.on('exit', (code) => {
        clearTimeout(timer);
        
        if (timedOut) {
          resolve({
            stdout,
            stderr: stderr + `\nValidator timeout after ${timeout}ms`,
            code: -1
          });
        } else {
          resolve({ stdout, stderr, code });
        }
      });
    });
  }

  parseOutput(stdout, stderr, code) {
    const missingFields = [];
    const warnings = [];
    
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('Missing:')) {
        const field = line.replace(/.*Missing:\s*/, '').trim();
        if (field) missingFields.push(field);
      }
      if (line.includes('Warning:')) {
        const warning = line.replace(/.*Warning:\s*/, '').trim();
        if (warning) warnings.push(warning);
      }
    }
    
    return {
      ok: code === 0 && missingFields.length === 0,
      missing_fields: missingFields,
      warnings,
      tool_version: 'validate-doc-structure.sh@1.2.0',
      log: stdout,
      stderr
    };
  }

  explainFailure(result) {
    const missing = result.missing_fields;
    
    if (missing.length === 0) {
      return 'Validation passed';
    } else if (missing.includes('validator_error')) {
      return 'Validator script failed to run';
    } else if (missing.length === 1) {
      return `Missing required field: ${missing[0]}`;
    } else {
      return `Missing ${missing.length} required fields: ${missing.join(', ')}`;
    }
  }
}

module.exports = ResilientValidator;