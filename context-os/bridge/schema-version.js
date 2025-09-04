/**
 * Schema Version Manager
 * Handles versioning and backward compatibility for JSON schemas
 */

const CURRENT_VERSION = '1.0.0';

const SCHEMA_VERSIONS = {
  '1.0.0': {
    claudeResult: ['status', 'findings', 'recommendations', 'confidence', 'logs', 'metadata'],
    contextResult: ['status', 'changes', 'reportPath', 'patchPath', 'logs', 'rollback'],
    combinedResult: ['status', 'summary', 'artifacts', 'diffs', 'logs', 'telemetry']
  }
};

class SchemaVersionManager {
  constructor() {
    this.currentVersion = CURRENT_VERSION;
  }
  
  /**
   * Add version to outgoing data
   */
  addVersion(data) {
    return {
      ...data,
      schemaVersion: this.currentVersion
    };
  }
  
  /**
   * Validate and migrate incoming data
   */
  validate(data, expectedType) {
    const version = data.schemaVersion || '1.0.0';
    
    // If same version, just validate
    if (version === this.currentVersion) {
      return this.validateSchema(data, expectedType, version);
    }
    
    // If older version, migrate
    if (this.isOlderVersion(version)) {
      const migrated = this.migrate(data, version, this.currentVersion);
      return this.validateSchema(migrated, expectedType, this.currentVersion);
    }
    
    // If newer version, try to handle gracefully
    if (this.isNewerVersion(version)) {
      console.warn(`⚠️  Received newer schema version ${version}, current is ${this.currentVersion}`);
      // Attempt to use anyway, but mark as potentially incompatible
      data.compatibilityWarning = true;
      return data;
    }
    
    throw new Error(`Unknown schema version: ${version}`);
  }
  
  /**
   * Validate schema structure
   */
  validateSchema(data, type, version) {
    const expectedFields = SCHEMA_VERSIONS[version][type];
    
    if (!expectedFields) {
      throw new Error(`Unknown schema type: ${type} for version ${version}`);
    }
    
    // Check required fields
    const missingFields = [];
    for (const field of expectedFields) {
      if (!(field in data)) {
        // Some fields are optional
        if (['metadata', 'telemetry', 'rollback', 'diffs'].includes(field)) {
          continue;
        }
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      console.warn(`⚠️  Missing fields in ${type}: ${missingFields.join(', ')}`);
      // Add default values for missing fields
      for (const field of missingFields) {
        data[field] = this.getDefaultValue(field);
      }
    }
    
    return data;
  }
  
  /**
   * Migrate data from old version to new
   */
  migrate(data, fromVersion, toVersion) {
    console.log(`📦 Migrating schema from ${fromVersion} to ${toVersion}`);
    
    // For now, we only have 1.0.0, but this is where migrations would go
    // Example migration:
    // if (fromVersion === '0.9.0' && toVersion === '1.0.0') {
    //   data.schemaVersion = '1.0.0';
    //   if (data.result) {
    //     data.findings = data.result;
    //     delete data.result;
    //   }
    // }
    
    data.schemaVersion = toVersion;
    return data;
  }
  
  /**
   * Get default value for field
   */
  getDefaultValue(field) {
    const defaults = {
      status: 'unknown',
      findings: [],
      recommendations: [],
      changes: [],
      logs: [],
      summary: '',
      artifacts: {},
      diffs: [],
      confidence: 0
    };
    
    return defaults[field] || null;
  }
  
  /**
   * Check if version is older
   */
  isOlderVersion(version) {
    const [major, minor, patch] = version.split('.').map(Number);
    const [currMajor, currMinor, currPatch] = this.currentVersion.split('.').map(Number);
    
    if (major < currMajor) return true;
    if (major === currMajor && minor < currMinor) return true;
    if (major === currMajor && minor === currMinor && patch < currPatch) return true;
    
    return false;
  }
  
  /**
   * Check if version is newer
   */
  isNewerVersion(version) {
    const [major, minor, patch] = version.split('.').map(Number);
    const [currMajor, currMinor, currPatch] = this.currentVersion.split('.').map(Number);
    
    if (major > currMajor) return true;
    if (major === currMajor && minor > currMinor) return true;
    if (major === currMajor && minor === currMinor && patch > currPatch) return true;
    
    return false;
  }
  
  /**
   * Get current schema version
   */
  getCurrentVersion() {
    return this.currentVersion;
  }
  
  /**
   * Get schema definition for a type
   */
  getSchema(type, version = this.currentVersion) {
    return SCHEMA_VERSIONS[version]?.[type] || null;
  }
}

module.exports = { SchemaVersionManager, CURRENT_VERSION };