#!/usr/bin/env node
// Fails if CI attempts to write into .context-memory/live during job runtime.
// Usage in CI: run before/after job steps and compare mtimes or use a lock sentinel.

const fs = require('fs').promises
const path = require('path')

async function main() {
  const base = path.join(__dirname, '..', 'live')
  try {
    const before = process.env.CI_READONLY_BASE_SNAPSHOT
    if (!before) {
      // Emit snapshot of mtimes as JSON to stdout for later compare
      const files = ['state.json', 'journal.ndjson', 'summary.md']
      const mtimes = {}
      for (const f of files) {
        try {
          const st = await fs.stat(path.join(base, f))
          mtimes[f] = st.mtimeMs
        } catch {}
      }
      process.stdout.write(JSON.stringify(mtimes))
      return
    }
    // Compare
    const prev = JSON.parse(before)
    const files = ['state.json', 'journal.ndjson', 'summary.md']
    for (const f of files) {
      try {
        const st = await fs.stat(path.join(base, f))
        const cur = st.mtimeMs
        const old = prev[f]
        if (old && cur > old + 1) {
          console.error(`CI write detected to ${f} (mtime increased)`) 
          process.exit(2)
        }
      } catch {}
    }
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
}

main()

