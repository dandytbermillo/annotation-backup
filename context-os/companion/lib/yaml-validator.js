const yaml = require('js-yaml');

class YAMLValidator {
  constructor() {
    this.requiredFields = ['meta_version', 'feature_slug', 'status'];
    this.validStatuses = ['draft', 'ready', 'frozen'];
  }

  extract(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (match) {
      return { frontMatter: match[1], body: match[2] };
    }
    return { frontMatter: '', body: content };
  }

  parse(yamlContent) {
    try {
      return yaml.load(yamlContent) || {};
    } catch (error) {
      throw new Error(`Invalid YAML: ${error.message}`);
    }
  }

  validate(data) {
    const errors = [];
    
    // Check required fields
    for (const field of this.requiredFields) {
      if (!data[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Validate status
    if (data.status && !this.validStatuses.includes(data.status)) {
      errors.push(`Invalid status: ${data.status}`);
    }
    
    // Validate readiness score
    if (data.readiness_score !== undefined) {
      if (data.readiness_score < 1 || data.readiness_score > 10) {
        errors.push(`Invalid readiness_score: ${data.readiness_score}`);
      }
    }
    
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    
    return true;
  }

  merge(content, headerPatch) {
    const { frontMatter, body } = this.extract(content);
    const existing = this.parse(frontMatter);
    const patched = { ...existing, ...headerPatch };
    
    this.validate(patched);
    
    const newYaml = yaml.dump(patched, {
      sortKeys: true,
      lineWidth: 80,
      noRefs: true
    });
    
    return `---\n${newYaml}---\n\n${body}`;
  }

  applyPatch(content, patch) {
    try {
      return this.merge(content, patch);
    } catch (error) {
      throw new Error(`Failed to apply YAML patch: ${error.message}`);
    }
  }
}

module.exports = YAMLValidator;