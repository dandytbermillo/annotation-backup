import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;

    // Fetch the latest content from document_saves table
    const query = `
      SELECT content, version, created_at
      FROM document_saves
      WHERE note_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [itemId]);

    if (result.rows.length === 0) {
      return NextResponse.json({
        success: false,
        content: null,
        message: 'No content found for this item'
      });
    }

    const contentData = result.rows[0];

    // Extract text content from the ProseMirror JSON structure
    let textContent = '';

    if (contentData.content) {
      textContent = extractTextFromContent(contentData.content);
    }

    return NextResponse.json({
      success: true,
      content: textContent,
      version: contentData.version,
      lastSaved: contentData.created_at
    });

  } catch (error) {
    console.error('Error fetching item content:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Helper function to extract text from ProseMirror JSON content
function extractTextFromContent(content: any): string {
  if (!content) return '';

  // If it's already a string, return it
  if (typeof content === 'string') return content;

  // Handle ProseMirror doc structure
  if (content.type === 'doc' && content.content) {
    return extractTextFromNodes(content.content);
  }

  // If it's an object with content array
  if (Array.isArray(content)) {
    return extractTextFromNodes(content);
  }

  return JSON.stringify(content);
}

function extractTextFromNodes(nodes: any[]): string {
  let text = '';

  for (const node of nodes) {
    if (node.type === 'text') {
      text += node.text || '';
    } else if (node.type === 'paragraph') {
      if (node.content) {
        text += extractTextFromNodes(node.content) + '\n\n';
      } else {
        text += '\n';
      }
    } else if (node.type === 'heading') {
      if (node.content) {
        text += extractTextFromNodes(node.content) + '\n\n';
      }
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      if (node.content) {
        text += extractTextFromNodes(node.content);
      }
    } else if (node.type === 'listItem') {
      if (node.content) {
        text += '• ' + extractTextFromNodes(node.content);
      }
    } else if (node.type === 'codeBlock') {
      if (node.content) {
        text += '```\n' + extractTextFromNodes(node.content) + '```\n\n';
      }
    } else if (node.type === 'blockquote') {
      if (node.content) {
        text += '> ' + extractTextFromNodes(node.content) + '\n\n';
      }
    } else if (node.type === 'hardBreak') {
      text += '\n';
    } else if (node.content) {
      text += extractTextFromNodes(node.content);
    }
  }

  return text;
}
