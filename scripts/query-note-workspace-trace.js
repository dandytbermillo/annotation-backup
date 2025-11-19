#!/usr/bin/env node

/**
 * Query recent note-workspace trace logs to understand branch panel lifecycle timing.
 *
 * Usage:
 *   node scripts/query-note-workspace-trace.js --minutes 15 --limit 400 --workspace <id> --note <id>
 *
 * Environment:
 *   DATABASE_URL can override the default postgres connection string.
 */

const { Pool } = require("pg")

const ACTIONS = [
  "branch_trace_panel_mount",
  "branch_trace_panel_unmount",
  "branch_trace_content_ready",
  "branch_trace_panel_update_start",
  "branch_trace_panel_update_commit",
  "panel_snapshot_updated",
  "snapshot_capture_start",
  "snapshot_capture_complete",
  "save_attempt",
  "save_skip_no_changes",
  "save_success",
  "save_error",
]

function parseArgs(argv) {
  const options = {
    minutes: 20,
    limit: 500,
    workspaceId: null,
    noteId: null,
    panelId: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith("--")) continue
    const value = argv[i + 1]
    switch (arg) {
      case "--minutes":
        options.minutes = Number(value) > 0 ? Number(value) : options.minutes
        i += 1
        break
      case "--limit":
        options.limit = Number(value) > 0 ? Number(value) : options.limit
        i += 1
        break
      case "--workspace":
      case "--workspaceId":
        options.workspaceId = value || null
        i += 1
        break
      case "--note":
      case "--noteId":
        options.noteId = value || null
        i += 1
        break
      case "--panel":
      case "--panelId":
        options.panelId = value || null
        i += 1
        break
      default:
        break
    }
  }

  return options
}

async function main() {
  const { minutes, limit, workspaceId, noteId, panelId } = parseArgs(process.argv.slice(2))
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.NOTE_WORKSPACE_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/annotation_dev"

  const pool = new Pool({ connectionString })

  const params = [ACTIONS, `${minutes} minutes`, limit]
  let paramIndex = params.length + 1
  const filters = []

  if (workspaceId) {
    filters.push(`metadata->>'workspaceId' = $${paramIndex}`)
    params.push(workspaceId)
    paramIndex += 1
  }
  if (noteId) {
    filters.push(`metadata->>'noteId' = $${paramIndex}`)
    params.push(noteId)
    paramIndex += 1
  }
  if (panelId) {
    filters.push(`metadata->>'panelId' = $${paramIndex}`)
    params.push(panelId)
    paramIndex += 1
  }

  const filterSql = filters.length > 0 ? `AND ${filters.join(" AND ")}` : ""

  try {
    const result = await pool.query(
      `
      SELECT
        component,
        action,
        metadata,
        to_char(created_at, 'YYYY-MM-DD HH24:MI:SS.MS') AS time,
        EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms
      FROM debug_logs
      WHERE action = ANY($1)
        AND created_at >= NOW() - $2::interval
        ${filterSql}
      ORDER BY created_at ASC
      LIMIT $3
    `,
      params,
    )

    if (result.rows.length === 0) {
      console.log("No trace events found (adjust --minutes or trigger the scenario again).")
      await pool.end()
      return
    }

    console.log(
      `\n=== Note Workspace Trace (${result.rows.length} events, last ${minutes} min, limit ${limit}) ===\n`,
    )
    result.rows.forEach((row, index) => {
      const metadata = row.metadata || {}
      const summaryParts = []
      if (metadata.workspaceName) summaryParts.push(`workspace=${metadata.workspaceName}`)
      if (metadata.workspaceId) summaryParts.push(`workspaceId=${metadata.workspaceId}`)
      if (metadata.noteId) summaryParts.push(`note=${metadata.noteId}`)
      if (metadata.panelId) summaryParts.push(`panel=${metadata.panelId}`)
      if (metadata.isMain !== undefined) summaryParts.push(`isMain=${metadata.isMain}`)
      if (metadata.reason) summaryParts.push(`reason=${metadata.reason}`)
      if (metadata.durationMs !== undefined) summaryParts.push(`duration=${metadata.durationMs}ms`)
      if (metadata.openNoteCount !== undefined) summaryParts.push(`open=${metadata.openNoteCount}`)
      if (metadata.panelCount !== undefined) summaryParts.push(`panels=${metadata.panelCount}`)
      if (metadata.timestampMs !== undefined) summaryParts.push(`ts=${metadata.timestampMs}`)

      console.log(`${index + 1}. [${row.time}] ${row.action}`)
      if (summaryParts.length > 0) {
        console.log(`   ${summaryParts.join(" | ")}`)
      }
      const extraKeys = Object.keys(metadata).filter(
        (key) =>
          ![
            "workspaceName",
            "workspaceId",
            "noteId",
            "panelId",
            "isMain",
            "reason",
            "durationMs",
            "openNoteCount",
            "panelCount",
            "timestampMs",
          ].includes(key),
      )
      if (extraKeys.length > 0) {
        extraKeys.forEach((key) => {
          console.log(`   ${key}: ${JSON.stringify(metadata[key])}`)
        })
      }
      console.log("")
    })

    await pool.end()
  } catch (error) {
    console.error("Failed to query trace logs:", error.message)
    process.exitCode = 1
  }
}

main()
