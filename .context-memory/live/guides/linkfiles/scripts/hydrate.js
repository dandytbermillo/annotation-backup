#!/usr/bin/env node
// Outputs current live context (state + last 50 journal events summary)

const { readLastNLines, readState } = require('./utils')

async function main() {
  const state = await readState()
  const lines = await readLastNLines(50)
  const events = []
  for (const l of lines) {
    try { events.push(JSON.parse(l)) } catch {}
  }
  const out = {
    state,
    recentEventCount: events.length,
    recentTypes: events.map(e => e.type),
  }
  console.log(JSON.stringify(out, null, 2))
}

main().catch((err) => { console.error(err); process.exit(1) })

