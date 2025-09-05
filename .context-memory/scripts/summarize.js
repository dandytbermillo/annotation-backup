#!/usr/bin/env node
// Regenerates .context-memory/live/summary.md from state + recent journal events

const fs = require('fs')
const fsp = require('fs').promises
const { readLastNLines, readState, SUMMARY_PATH } = require('./utils')

function redact(s) {
  if (!s) return s
  let out = String(s)
  // Mask likely API keys (e.g., sk-... long tokens)
  out = out.replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
  // Mask long hex/base64-like tokens
  out = out.replace(/[A-Za-z0-9+\/=]{24,}/g, '[REDACTED]')
  // Mask simple password= or token= patterns
  out = out.replace(/(password|token|secret)=[^\s]+/gi, '$1=[REDACTED]')
  return out
}

function parseLines(lines) {
  const out = []
  for (const l of lines) {
    try { out.push(JSON.parse(l)) } catch {}
  }
  return out
}

function render(state, events) {
  const current = state ? {
    feature: state.current_feature,
    branch: state.current_branch || '(unset)',
    status: state.status,
  } : { feature: '(unknown)', branch: '(unset)', status: '(unknown)' }

  const recent = events.slice(-10).reverse()
  const bullets = []
  for (const e of recent) {
    if (e.type === 'commit') bullets.push(`- commit ${String(e.sha||'').slice(0,7)}: ${redact(e.message || '')}`)
    else if (e.type === 'issue') bullets.push(`- issue (${e.area||'general'}): ${redact(e.desc||'')}`)
    else if (e.type === 'fix') bullets.push(`- fix (${e.area||'general'}): ${redact(e.desc||'')}`)
    else if (e.type === 'test') bullets.push(`- test: ${e.result} (${e.count||0})`)
    else if (e.type === 'note') bullets.push(`- note: ${redact(e.text||'')}`)
  }

  // Health Snapshot from the latest test/perf events
  const latestTest = [...events].reverse().find(e => e.type === 'test')
  const healthLines = []
  if (latestTest) {
    healthLines.push(`- Tests: ${latestTest.result} (${latestTest.count||0})`)
  }

  const lines = [
    '# Context-OS — Live Context Summary',
    '',
    'Current Work',
    `- Feature: ${current.feature}`,
    `- Branch: ${current.branch}`,
    `- Status: ${current.status}`,
    '',
    'Recent Activity',
    ...(bullets.length ? bullets : ['- (none)']),
    '',
    'Health Snapshot',
    ...(healthLines.length ? healthLines : ['- (no recent data)']),
  ]
  return lines.join('\n') + '\n'
}

async function main() {
  const state = await readState()
  const tail = await readLastNLines(200)
  const events = parseLines(tail)
  const md = render(state, events)
  const tmp = SUMMARY_PATH + '.tmp'
  await fsp.writeFile(tmp, md, 'utf8')
  await fsp.rename(tmp, SUMMARY_PATH)
  const size = Buffer.byteLength(md, 'utf8')
  if (size > 2000 * 5) {
    console.warn('summary.md exceeds ~10KB; consider fewer bullets or tighter descriptions')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

