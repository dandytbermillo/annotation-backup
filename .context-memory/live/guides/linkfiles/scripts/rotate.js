#!/usr/bin/env node
// Rotates .context-memory/live/journal.ndjson if it grows beyond ~5 MB

const path = require('path')
const fsp = require('fs').promises
const { JOURNAL_PATH, LIVE_DIR } = require('./utils')
const fs = require('fs')

async function main() {
  try {
    const stat = await fsp.stat(JOURNAL_PATH)
    const archiveDir = path.join(LIVE_DIR, 'archive')
    await fsp.mkdir(archiveDir, { recursive: true })
    const iso = new Date().toISOString().replace(/[:]/g, '-')
    // Rotate if file too large OR too many lines (>10,000)
    let tooManyLines = false
    if (stat.size <= 5 * 1024 * 1024) {
      try {
        const content = await fsp.readFile(JOURNAL_PATH, 'utf8')
        const lines = content.split(/\r?\n/).filter(Boolean)
        tooManyLines = lines.length > 10000
      } catch {}
    }
    if (stat.size > 5 * 1024 * 1024 || tooManyLines) {
      const target = path.join(archiveDir, `journal-${iso}.ndjson`)
      await fsp.rename(JOURNAL_PATH, target)
      await fsp.writeFile(JOURNAL_PATH, '', 'utf8')
      console.log(`Rotated journal to ${target}`)
    }
  } catch (err) {
    // No journal or other error; noop
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

