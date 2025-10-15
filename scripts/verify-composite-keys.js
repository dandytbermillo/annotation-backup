#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'docs',
  'codex',
  '.context-memory',
  'public',
  'backup',
])

const ANTI_PATTERNS = [
  {
    description: 'Legacy DataStore calls with plain panelId',
    regex: /dataStore\.(?:get|set|update|has)\(\s*panelId\b/g,
  },
  {
    description: 'Legacy branchesMap calls with plain panelId',
    regex: /branchesMap\.(?:get|set|has)\(\s*panelId\b/g,
  },
  {
    description: 'window.canvasDataStore lookups using plain panelId',
    regex: /canvasDataStore\?\.get\?\?\(panelId/g,
  },
]

const REQUIRED_PATTERNS = [
  {
    description: '`storeKey || panelId` fallback in use-panel-persistence',
    file: path.join(root, 'lib/hooks/use-panel-persistence.ts'),
    regex: /const key = storeKey \|\| panelId/,
  },
  {
    description: 'persistPanelUpdate callers pass storeKey',
    file: path.join(root, 'components/canvas/canvas-panel.tsx'),
    regex: /persistPanelUpdate\(\{[\s\S]*storeKey:/,
  },
  {
    description: 'persistPanelCreate callers pass storeKey',
    file: path.join(root, 'components/annotation-canvas-modern.tsx'),
    regex: /persistPanelCreate\(\{[\s\S]*storeKey:/,
  },
]

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
    } else if (/\.(ts|tsx|js)$/.test(entry.name) && !fullPath.includes('.backup') && !fullPath.includes('.bak')) {
      filesToCheck.push(fullPath)
    }
  }
}

const filesToCheck = []
const RELATIVE_SKIPS = new Set([
  'components/annotation-canvas.tsx', // Legacy canvas implementation (deprecated)
  'lib/yjs-provider.ts',             // Third-party provider shim awaiting migration
])
walk(path.join(root, 'components'))
walk(path.join(root, 'hooks'))
walk(path.join(root, 'lib'))

const failures = []

for (const file of filesToCheck) {
  const rel = path.relative(root, file)
  if (RELATIVE_SKIPS.has(rel)) continue
  const text = fs.readFileSync(file, 'utf8')
  ANTI_PATTERNS.forEach(({ description, regex }) => {
    regex.lastIndex = 0
    if (regex.test(text)) {
      failures.push({ file, description })
    }
  })
}

REQUIRED_PATTERNS.forEach(({ description, file, regex }) => {
  let exists = false
  try {
    const text = fs.readFileSync(file, 'utf8')
    exists = regex.test(text)
  } catch (err) {
    failures.push({ file, description: `${description} (missing file)` })
    return
  }
  if (!exists) {
    failures.push({ file, description })
  }
})

if (failures.length > 0) {
  console.error('❌ Composite key verification failed:')
  failures.forEach(({ file, description }) => {
    console.error(`  - ${description}: ${path.relative(root, file)}`)
  })
  process.exit(1)
}

console.log('✅ Composite key verification passed')
