#!/usr/bin/env node
// Logs the latest commit affecting the repo (manual call or via git hook)

const { execSync } = require('child_process')
const { appendEvent, nowIso, truncate } = require('./utils')

function sh(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
}

async function main() {
  const sha = sh('git rev-parse HEAD')
  const msg = sh('git log -1 --pretty=%B')
  const filesRaw = sh(`git diff-tree --no-commit-id --name-only -r ${sha}`)
  const files = filesRaw ? filesRaw.split('\n').filter(Boolean) : []
  await appendEvent({
    ts: nowIso(),
    type: 'commit',
    sha,
    files_changed: files.length,
    message: truncate(msg.replace(/\s+/g, ' ').trim()).slice(0, 120),
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

