/**
 * File Preview API
 *
 * GET /api/chat/preview/file?path=...
 *
 * Returns file content for preview in the View Panel.
 * Security: Only allows specific extensions and paths within allowed directories.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

// Allowed file extensions for preview
const ALLOWED_EXTENSIONS = ['md', 'txt', 'ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'css', 'html']

// Maximum file size (500KB)
const MAX_FILE_SIZE = 500 * 1024

// Allowed directories (explicit allowlist)
const ALLOWED_DIRS = [
  path.join(process.cwd(), 'docs'),
  path.join(process.cwd(), 'codex'),
]

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path')

  if (!filePath) {
    return NextResponse.json({ error: 'path parameter is required' }, { status: 400 })
  }

  // Get file extension
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      { error: `File type '${ext}' is not supported for preview` },
      { status: 400 }
    )
  }

  // Resolve and normalize path
  const resolvedPath = path.resolve(filePath)
  const normalizedPath = path.normalize(resolvedPath)

  // Security: Ensure path is within allowed directories
  const isAllowed = ALLOWED_DIRS.some((dir) => normalizedPath.startsWith(dir))
  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Access denied. File is outside allowed directories.' },
      { status: 403 }
    )
  }

  try {
    // Check file size first
    const stats = await stat(normalizedPath)
    if (stats.size > MAX_FILE_SIZE * 2) {
      return NextResponse.json(
        { error: 'File is too large for preview (max 500KB)' },
        { status: 413 }
      )
    }

    // Read file content
    const content = await readFile(normalizedPath, 'utf-8')
    const lines = content.split('\n')

    // Truncate if necessary
    const truncated = content.length > MAX_FILE_SIZE
    const truncatedContent = truncated ? content.slice(0, MAX_FILE_SIZE) : content

    return NextResponse.json({
      content: truncatedContent,
      lineCount: lines.length,
      size: stats.size,
      truncated,
      filename: path.basename(normalizedPath),
      extension: ext,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    console.error('[chat/preview/file] Error:', error)
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}
