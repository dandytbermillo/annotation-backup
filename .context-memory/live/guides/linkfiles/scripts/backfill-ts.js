#!/usr/bin/env node
const fs = require('fs')
const path = '.context-memory/live/journal.ndjson'
const raw = fs.readFileSync(path, 'utf8').split(/\r?\n/)
const events = raw.filter(Boolean).map((l, idx) => {
  try { const o = JSON.parse(l); return {o, idx} } catch { return {o:null, idx, bad:l} }
})

// Identify groups of consecutive events with missing/empty ts
function hasTs(e){ return e && e.ts && String(e.ts).trim().length > 0 }
const len = events.length
let i = 0
let modified = 0
while (i < len) {
  const e = events[i].o
  const missing = e && !hasTs(e)
  if (!missing) { i++; continue }
  // find group [i, j)
  let j = i
  while (j < len && events[j].o && !hasTs(events[j].o)) j++
  // find next with ts at j, and prev with ts before i
  let nextTs = null
  for (let k=j; k<len; k++) {
    const ok = events[k].o
    if (ok && hasTs(ok)) { nextTs = Date.parse(ok.ts); break }
  }
  let prevTs = null
  for (let k=i-1; k>=0; k--) {
    const ok = events[k].o
    if (ok && hasTs(ok)) { prevTs = Date.parse(ok.ts); break }
  }
  const group = events.slice(i, j)
  if (nextTs != null) {
    // Assign times before nextTs, spaced by 1s, preserving order
    for (let g=0; g<group.length; g++) {
      const assign = new Date(nextTs - (group.length - g) * 1000).toISOString()
      group[g].o.ts = assign
      modified++
    }
  } else if (prevTs != null) {
    // Assign times after prevTs
    for (let g=0; g<group.length; g++) {
      const assign = new Date(prevTs + (g + 1) * 1000).toISOString()
      group[g].o.ts = assign
      modified++
    }
  } else {
    // No prev/next; base on now in order
    const base = Date.now()
    for (let g=0; g<group.length; g++) {
      const assign = new Date(base + g * 1000).toISOString()
      group[g].o.ts = assign
      modified++
    }
  }
  i = j
}

if (modified > 0) {
  const out = events.map(e => e.o ? JSON.stringify(e.o) : e.bad).join('\n') + '\n'
  fs.writeFileSync(path, out, 'utf8')
}
console.log(JSON.stringify({modified}))
