#!/usr/bin/env node

/**
 * Image Handler for UI/Bridge Layer
 * Implements Option A: UI/Bridge-only image handling
 * No Context-OS changes required - enriches text before passing to Context-OS
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ImageHandler {
  constructor() {
    this.maxImages = 5;
    this.maxSizeBytes = 5 * 1024 * 1024; // 5MB
    this.allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    this.artifactsDir = null;
  }

  /**
   * Detect images in the composer/message at submit time
   * In Claude Code, this would be called when processing attachments
   */
  detectComposerImages(attachments = []) {
    const manifest = [];
    
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      manifest.push({
        id: `img-${i + 1}`,
        index: i + 1,
        name: attachment.name || `image-${i + 1}`,
        mime: attachment.mime || 'image/png',
        size: attachment.size || 0,
        path: attachment.path,
        url: attachment.url
      });
    }
    
    return manifest;
  }

  /**
   * Resolve image tokens (@1, @2, etc.) to actual images
   * Maps tokens to manifest entries
   */
  resolveImagesFlag(input, manifest) {
    const resolved = [];
    const tokenPattern = /@(\d+)/g;
    const tokens = [];
    
    // Extract all @n tokens from input
    let match;
    while ((match = tokenPattern.exec(input)) !== null) {
      tokens.push(parseInt(match[1]));
    }
    
    // Case 1: Tokens present but no attachments
    if (tokens.length > 0 && manifest.length === 0) {
      throw new Error('No images detected. Attach screenshots or pass resolvable paths/URLs via --files or JSON (images: []).');
    }
    
    // Case 2: Attachments exist but no tokens (or edited tokens)
    if (manifest.length > 0 && tokens.length === 0) {
      console.warn('No image tokens found; using attached images in the order shown.');
      return manifest;
    }
    
    // Case 3: Map tokens to manifest
    const seen = new Set();
    for (const tokenIndex of tokens) {
      if (tokenIndex > 0 && tokenIndex <= manifest.length) {
        const image = manifest[tokenIndex - 1];
        const hash = this.getContentHash(image);
        
        if (!seen.has(hash)) {
          resolved.push(image);
          seen.add(hash);
        } else {
          console.warn('Duplicate image ignored (same content).');
        }
      } else {
        console.warn(`Token @${tokenIndex} out of range (${manifest.length} images available)`);
      }
    }
    
    return resolved;
  }

  /**
   * Persist images if needed for deterministic repo-relative paths
   */
  async persistIfNeeded(images, featureSlug) {
    if (!featureSlug) return images;
    
    const persisted = [];
    const artifactsPath = path.join('docs/proposal', featureSlug, 'implementation-details', 'artifacts');
    
    // Ensure artifacts directory exists
    if (!fs.existsSync(artifactsPath)) {
      fs.mkdirSync(artifactsPath, { recursive: true });
      this.artifactsDir = artifactsPath;
    }
    
    for (const image of images) {
      if (image.path && fs.existsSync(image.path)) {
        // Copy to artifacts directory
        const ext = path.extname(image.name || '.png');
        const filename = `${Date.now()}-${image.index}${ext}`;
        const targetPath = path.join(artifactsPath, filename);
        
        fs.copyFileSync(image.path, targetPath);
        
        persisted.push({
          ...image,
          persistedPath: `./${path.relative('docs/proposal/' + featureSlug, targetPath)}`
        });
      } else if (image.url) {
        // Keep URL reference
        persisted.push(image);
      }
    }
    
    return persisted;
  }

  /**
   * Build the enriched envelope with image metadata
   * This is what gets passed to Context-OS
   */
  buildEnvelope(command, params, images = []) {
    const envelope = {
      ok: true,
      command: command,
      feature: params.feature,
      issue: params.issue,
      metrics: params.metrics || {},
      environment: params.environment || 'dev'
    };
    
    // Add image metadata if present
    if (images.length > 0) {
      envelope.images = images.map(img => ({
        mediaType: img.mime,
        path: img.persistedPath || img.path || img.url
      }));
      
      // Track artifacts
      envelope.artifacts = images
        .filter(img => img.persistedPath)
        .map(img => img.persistedPath);
    }
    
    return envelope;
  }

  /**
   * Enrich issue description with visual findings
   * This is the key: Context-OS receives enriched text, not raw images
   */
  enrichIssueWithVisualFindings(issue, visualAnalysis) {
    if (!visualAnalysis || visualAnalysis.length === 0) {
      return issue;
    }
    
    // Append visual findings to the issue description
    let enrichedIssue = issue;
    
    enrichedIssue += '\n\n[Visual Analysis Detected]';
    for (const finding of visualAnalysis) {
      enrichedIssue += `\n- ${finding}`;
    }
    
    return enrichedIssue;
  }

  /**
   * Validate image constraints
   */
  validateImages(images) {
    const errors = [];
    
    if (images.length > this.maxImages) {
      errors.push(`Too many images (${images.length}). Maximum ${this.maxImages} allowed.`);
    }
    
    for (const image of images) {
      if (image.size && image.size > this.maxSizeBytes) {
        errors.push(`Image '${image.name}' exceeds 5MB limit.`);
      }
      
      if (image.mime && !this.allowedTypes.includes(image.mime)) {
        errors.push(`Image '${image.name}' has unsupported type: ${image.mime}`);
      }
    }
    
    return errors;
  }

  /**
   * Get content hash for deduplication
   */
  getContentHash(image) {
    // In production, would hash actual file content
    // For now, use path/url as identifier
    const identifier = image.path || image.url || image.name;
    return crypto.createHash('sha256').update(identifier).digest('hex');
  }

  /**
   * Main processing function - called by bridge
   * This enriches the command before passing to Context-OS
   */
  async processCommand(command, params, attachments = []) {
    const result = {
      success: false,
      enrichedParams: params,
      telemetry: {
        imagesCaptured: 0,
        imagesBound: 0
      }
    };
    
    try {
      // Step 1: Detect images
      const manifest = this.detectComposerImages(attachments);
      result.telemetry.imagesCaptured = manifest.length;
      
      if (manifest.length === 0) {
        // No images, pass through as-is
        result.success = true;
        return result;
      }
      
      // Step 2: Resolve image references
      let resolved = manifest;
      if (params.issue && params.issue.includes('@')) {
        resolved = this.resolveImagesFlag(params.issue, manifest);
      }
      
      // Step 3: Validate constraints
      const errors = this.validateImages(resolved);
      if (errors.length > 0) {
        throw new Error(errors.join('; '));
      }
      
      // Step 4: Persist if needed
      const persisted = await this.persistIfNeeded(resolved, params.feature);
      result.telemetry.imagesBound = persisted.length;
      
      // Step 5: Build envelope with metadata
      const envelope = this.buildEnvelope(command, params, persisted);
      
      // Step 6: CRITICAL - Enrich issue text for Context-OS
      // This is where Claude's visual analysis would be inserted
      if (params.visualFindings && params.visualFindings.length > 0) {
        envelope.issue = this.enrichIssueWithVisualFindings(
          envelope.issue,
          params.visualFindings
        );
      }
      
      // Add image references to enriched text
      if (persisted.length > 0) {
        envelope.issue += '\n\n[Attached Images]';
        persisted.forEach((img, idx) => {
          const imgPath = img.persistedPath || img.path || img.url;
          envelope.issue += `\n- Image ${idx + 1}: ${imgPath}`;
        });
      }
      
      result.success = true;
      result.enrichedParams = envelope;
      result.artifacts = envelope.artifacts;
      
    } catch (error) {
      result.error = error.message;
    }
    
    return result;
  }
}

// Export for use in bridge
module.exports = ImageHandler;

// CLI interface for testing
if (require.main === module) {
  const handler = new ImageHandler();
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help') {
    console.log('Image Handler - UI/Bridge Layer for Option A');
    console.log('Usage: image-handler <command> [options]');
    console.log('\nCommands:');
    console.log('  test-enrich <issue> [--visual "finding1,finding2"]');
    console.log('  test-process <feature> <issue> [--images "path1,path2"]');
    console.log('\nExample:');
    console.log('  image-handler test-enrich "Button rendering issues" --visual "Button extends 20px beyond container,Text contrast ratio 1.3:1"');
    process.exit(0);
  }
  
  const command = args[0];
  
  if (command === 'test-enrich') {
    // Test enrichment of issue text
    const issue = args[1] || 'Test issue';
    const visualIndex = args.indexOf('--visual');
    const visualFindings = visualIndex > -1 ? args[visualIndex + 1].split(',') : [];
    
    const enriched = handler.enrichIssueWithVisualFindings(issue, visualFindings);
    console.log('Original issue:', issue);
    console.log('\nEnriched issue:', enriched);
    
  } else if (command === 'test-process') {
    // Test full processing
    const feature = args[1];
    const issue = args[2];
    const imagesIndex = args.indexOf('--images');
    const imagePaths = imagesIndex > -1 ? args[imagesIndex + 1].split(',') : [];
    
    const attachments = imagePaths.map((p, i) => ({
      name: path.basename(p),
      path: p,
      mime: 'image/png',
      size: 1000
    }));
    
    handler.processCommand('fix', { feature, issue }, attachments).then(result => {
      console.log(JSON.stringify(result, null, 2));
    });
  }
}