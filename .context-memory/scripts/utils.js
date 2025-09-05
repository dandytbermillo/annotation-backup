// Node-only utilities for live context under .context-memory/live
// No external dependencies

const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')

const LIVE_DIR = process.env.CONTEXT_MEMORY_LIVE_DIR
  ? path.resolve(process.env.CONTEXT_MEMORY_LIVE_DIR)
  : (process.env.CONTEXTOS_LIVE_DIR
      ? path.resolve(process.env.CONTEXTOS_LIVE_DIR)
      : path.join(__dirname, '..', 'live'))
const STATE_PATH = path.join(LIVE_DIR, 'state.json')
const JOURNAL_PATH = path.join(LIVE_DIR, 'journal.ndjson')
const SUMMARY_PATH = path.join(LIVE_DIR, 'summary.md')
const LOCK_PATH = path.join(LIVE_DIR, 'lock')

async function ensureLiveDir() {
  await fsp.mkdir(LIVE_DIR, { recursive: true })
}

async function withLock(fn, maxAttempts = 5) {
  await ensureLiveDir()
  let attempt = 0
  while (true) {
    try {
      const fd = await fsp.open(LOCK_PATH, 'wx')
      await fd.close()
      try {
        const res = await fn()
        return res
      } finally {
        try { await fsp.unlink(LOCK_PATH) } catch {}
      }
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        attempt++
        if (attempt >= maxAttempts) throw new Error('Lock busy; retries exhausted')
        const jitter = 50 + Math.floor(Math.random() * 200)
        await new Promise(r => setTimeout(r, jitter))
        continue
      }
      throw err
    }
  }
}

function nowIso() {
  return new Date().toISOString()
}

function truncate(str, max = 2000) {
  if (!str) return ''
  return str.length <= max ? str : str.slice(0, max - 1) + '…'
}

async function readState() {
  try {
    const raw = await fsp.readFile(STATE_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeState(next) {
  await withLock(async () => {
    const tmp = STATE_PATH + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
    await fsp.rename(tmp, STATE_PATH)
  })
}

async function appendEvent(obj) {
  const line = JSON.stringify(obj)
  if (line.length > 2048) throw new Error('Event exceeds 2KB; shorten fields')
  await withLock(async () => {
    await fsp.mkdir(path.dirname(JOURNAL_PATH), { recursive: true })
    await fsp.appendFile(JOURNAL_PATH, line + '\n', 'utf8')
  })
}

async function readLastNLines(n) {
  try {
    const content = await fsp.readFile(JOURNAL_PATH, 'utf8')
    const lines = content.split(/\r?\n/).filter(Boolean)
    return lines.slice(-n)
  } catch {
    return []
  }
}

module.exports = {
  LIVE_DIR,
  STATE_PATH,
  JOURNAL_PATH,
  SUMMARY_PATH,
  LOCK_PATH,
  ensureLiveDir,
  withLock,
  nowIso,
  truncate,
  readState,
  writeState,
  appendEvent,
  readLastNLines,
}
