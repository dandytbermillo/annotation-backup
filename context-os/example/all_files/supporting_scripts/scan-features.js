#!/usr/bin/env node

/**
 * Feature Scanner v2.0
 * Scans docs/proposal/ for features and outputs JSON with current status
 * Compliant with Documentation Process Guide v1.4.5
 */

const fs = require('fs');
const path = require('path');

// Schema version for forward compatibility
const SCHEMA_VERSION = '2.0.0';

// Canonical status values per Documentation Process Guide
const STATUS_MAP = {
  'COMPLETE': '✅ COMPLETE',
  'IN PROGRESS': '🚧 IN PROGRESS',
  'IN_PROGRESS': '🚧 IN PROGRESS',
  'BLOCKED': '❌ BLOCKED',
  'PLANNED': '📝 PLANNED',
  'UNKNOWN': '❓ UNKNOWN'
};

/**
 * Find implementation report using multiple patterns
 */
function findImplementationReport(featurePath) {
  const patterns = [
    'implementation.md',
    'Implementation.md',
    'IMPLEMENTATION.md',
    '*-implementation-report.md',
    '*-Implementation-Report.md',
    'reports/*-implementation-report.md',
    'reports/*-Implementation-Report.md',
    'INITIAL.md'
  ];
  
  // Check direct files first
  for (const pattern of patterns) {
    if (!pattern.includes('*') && !pattern.includes('/')) {
      const filePath = path.join(featurePath, pattern);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
  }
  
  // Check reports directory
  const reportsPath = path.join(featurePath, 'reports');
  if (fs.existsSync(reportsPath) && fs.statSync(reportsPath).isDirectory()) {
    const files = fs.readdirSync(reportsPath);
    for (const file of files) {
      if (file.toLowerCase().includes('implementation') && file.endsWith('.md')) {
        return path.join(reportsPath, file);
      }
    }
  }
  
  // Check root directory for pattern matches
  const files = fs.readdirSync(featurePath);
  for (const file of files) {
    if (file.toLowerCase().includes('implementation') && file.endsWith('.md')) {
      return path.join(featurePath, file);
    }
  }
  
  return null;
}

/**
 * Extract status from report content
 */
function extractStatus(content) {
  // Look for various status patterns
  const patterns = [
    /\*\*Status\*\*:\s*(.+)/i,
    /^Status:\s*(.+)/im,
    /^##\s*Status:\s*(.+)/im,
    /Current Status:\s*(.+)/i
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const statusLine = match[1].toUpperCase();
      
      if (statusLine.includes('COMPLETE')) {
        return 'COMPLETE';
      } else if (statusLine.includes('PROGRESS')) {
        return 'IN PROGRESS';
      } else if (statusLine.includes('BLOCKED')) {
        return 'BLOCKED';
      } else if (statusLine.includes('PLANNED')) {
        return 'PLANNED';
      }
    }
  }
  
  return 'UNKNOWN';
}

/**
 * Scan a single feature with error isolation
 */
function scanFeature(slug, featurePath) {
  try {
    // Default values
    let status = 'UNKNOWN';
    let fileCount = 0;
    let fixCount = 0;
    let lastModified = null;
    let hasReport = false;
    let validationIssues = [];
    
    // Find implementation report
    const reportPath = findImplementationReport(featurePath);
    if (reportPath) {
      hasReport = true;
      const content = fs.readFileSync(reportPath, 'utf8');
      status = extractStatus(content);
      
      // Get last modified date
      const stats = fs.statSync(reportPath);
      lastModified = stats.mtime.toISOString().split('T')[0];
    } else {
      validationIssues.push('Missing implementation report');
    }
    
    // Count files recursively
    function countFiles(dir) {
      try {
        let count = 0;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stat = fs.statSync(itemPath);
          if (stat.isDirectory()) {
            count += countFiles(itemPath);
          } else if (stat.isFile() && !item.startsWith('.')) {
            count++;
          }
        }
        return count;
      } catch (err) {
        // Log to stderr, continue with 0
        console.error(`Warning: Could not count files in ${dir}: ${err.message}`);
        return 0;
      }
    }
    
    fileCount = countFiles(featurePath);
    
    // Count fixes
    const fixesPath = path.join(featurePath, 'post-implementation-fixes');
    if (fs.existsSync(fixesPath)) {
      try {
        const fixes = fs.readdirSync(fixesPath);
        fixCount = fixes.filter(f => f.endsWith('.md')).length;
      } catch (err) {
        console.error(`Warning: Could not read fixes in ${fixesPath}: ${err.message}`);
      }
    } else {
      validationIssues.push('Missing post-implementation-fixes directory');
    }
    
    // Check for required directories per Documentation Process Guide
    const requiredDirs = ['reports', 'post-implementation-fixes'];
    for (const dir of requiredDirs) {
      if (!fs.existsSync(path.join(featurePath, dir))) {
        validationIssues.push(`Missing ${dir} directory`);
      }
    }
    
    // Normalize status to canonical value
    const canonicalStatus = STATUS_MAP[status] || STATUS_MAP['UNKNOWN'];
    
    // Determine next actions based on status and validation issues
    let nextActions = null;
    if (status === 'UNKNOWN' || !hasReport) {
      nextActions = `/fix --feature ${slug} --issue "Missing implementation report" --dry-run`;
    } else if (validationIssues.length > 0) {
      nextActions = `/validate ${slug} --strict`;
    } else if (status === 'BLOCKED') {
      nextActions = `/fix --feature ${slug} --issue "Unblock feature" --apply`;
    }
    
    return {
      slug,
      status: canonicalStatus,
      fileCount,
      fixCount,
      lastModified,
      path: `docs/proposal/${slug}`,
      hasReport,
      validationIssues,
      nextActions
    };
  } catch (error) {
    // Return error state for this feature
    console.error(`Error scanning feature ${slug}: ${error.message}`);
    return {
      slug,
      status: STATUS_MAP['UNKNOWN'],
      fileCount: 0,
      fixCount: 0,
      lastModified: null,
      path: `docs/proposal/${slug}`,
      hasReport: false,
      validationIssues: [`Scan error: ${error.message}`],
      nextActions: `/validate ${slug}`,
      error: error.message
    };
  }
}

function scanFeatures() {
  const root = path.join(__dirname, '..', 'docs', 'proposal');
  const features = [];
  const errors = [];
  
  if (!fs.existsSync(root)) {
    console.error(`Error: ${root} does not exist`);
    process.exit(1);
  }
  
  // Scan each directory in docs/proposal/
  const entries = fs.readdirSync(root);
  
  for (const slug of entries) {
    const featurePath = path.join(root, slug);
    
    // Skip if not a directory
    try {
      if (!fs.statSync(featurePath).isDirectory()) continue;
    } catch (err) {
      console.error(`Warning: Could not stat ${featurePath}: ${err.message}`);
      continue;
    }
    
    // Skip special directories and templates
    if (slug.startsWith('.') || slug === 'templates' || slug === 'DOCUMENTATION_PROCESS_GUIDE') {
      continue;
    }
    
    // Scan feature with error isolation
    const featureData = scanFeature(slug, featurePath);
    features.push(featureData);
    
    if (featureData.error) {
      errors.push({ slug, error: featureData.error });
    }
  }
  
  // Sort by status priority (IN PROGRESS > BLOCKED > PLANNED > COMPLETE > UNKNOWN)
  const statusOrder = {
    '🚧 IN PROGRESS': 1,
    '❌ BLOCKED': 2,
    '📝 PLANNED': 3,
    '✅ COMPLETE': 4,
    '❓ UNKNOWN': 5
  };
  
  features.sort((a, b) => {
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    return a.slug.localeCompare(b.slug);
  });
  
  const output = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy: 'context-os/scan-features',
    features,
    totalFeatures: features.length,
    byStatus: {
      inProgress: features.filter(f => f.status === '🚧 IN PROGRESS').length,
      blocked: features.filter(f => f.status === '❌ BLOCKED').length,
      planned: features.filter(f => f.status === '📝 PLANNED').length,
      complete: features.filter(f => f.status === '✅ COMPLETE').length,
      unknown: features.filter(f => f.status === '❓ UNKNOWN').length
    },
    validationSummary: {
      featuresWithIssues: features.filter(f => f.validationIssues.length > 0).length,
      totalIssues: features.reduce((sum, f) => sum + f.validationIssues.length, 0)
    },
    errors: errors.length > 0 ? errors : undefined
  };
  
  // Output JSON to stdout (data only)
  process.stdout.write(JSON.stringify(output, null, 2));
}

// Run scanner
try {
  scanFeatures();
} catch (error) {
  console.error(`Scanner error: ${error.message}`);
  process.exit(1);
}