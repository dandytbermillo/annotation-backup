#!/usr/bin/env node
// Usage: node .context-memory/scripts/log-event.js <type> [--k=v ...]

const { appendEvent, nowIso, truncate } = require('./utils')

function parseArgs(argv) {
  const out = {}
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

async function main() {
  const [type, ...rest] = process.argv.slice(2)
  if (!type) {
    console.error('Usage: node .context-memory/scripts/log-event.js <type> [--k=v ...]')
    process.exit(1)
  }
  const args = parseArgs(rest)
  const base = { ts: nowIso(), type }
  let payload = {}
  switch (type) {
    case 'commit':
      payload = {
        sha: args.sha || '',
        files_changed: Number(args.files_changed || '0'),
        message: truncate(args.message || '').slice(0, 120),
      }
      break
    case 'test':
      payload = {
        result: args.result || 'mixed',
        count: Number(args.count || '0'),
        focus: args.focus || undefined,
      }
      break
    case 'issue':
      payload = {
        desc: truncate(args.desc || ''),
        area: args.area || 'general',
        severity: args.severity || undefined,
      }
      break
    case 'fix':
      payload = {
        desc: truncate(args.desc || ''),
        area: args.area || 'general',
      }
      break
    case 'note':
      payload = { text: truncate(args.text || '') }
      break
    case 'chat':
      payload = {
        role: args.role || 'user',
        text: truncate(args.text || ''),
      }
      break
    default:
      console.error(`Unknown type: ${type}`)
      process.exit(1)
  }
  await appendEvent({ ...base, ...payload })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
