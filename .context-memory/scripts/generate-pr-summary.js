#!/usr/bin/env node
// Writes a PR-friendly snippet from live/summary.md and prints it.

const fs = require('fs').promises
const path = require('path')
const { SUMMARY_PATH, LIVE_DIR } = require('./utils')

async function main() {
  let content = ''
  try {
    content = await fs.readFile(SUMMARY_PATH, 'utf8')
  } catch {
    content = '# Context Summary\n\n(no summary yet)\n'
  }
  const snippet = `<!-- auto-generated: live context summary -->\n` + content
  const outPath = path.join(LIVE_DIR, 'pr-summary.md')
  await fs.writeFile(outPath, snippet, 'utf8')
  process.stdout.write(snippet)
}

main().catch((err) => { console.error(err); process.exit(1) })

