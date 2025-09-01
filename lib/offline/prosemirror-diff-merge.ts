/**
 * ProseMirror JSON Diff/Merge Utilities
 * 
 * Provides diff visualization and three-way merge capabilities
 * for ProseMirror documents in conflict resolution scenarios.
 */

import { diffLines, diffWords } from 'diff';

export interface ProseMirrorDoc {
  type: string;
  content?: ProseMirrorNode[];
  attrs?: Record<string, any>;
}

export interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: ProseMirrorMark[];
  attrs?: Record<string, any>;
}

export interface ProseMirrorMark {
  type: string;
  attrs?: Record<string, any>;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  unchanged: string[];
  conflicted: string[];
}

export interface MergeResult {
  success: boolean;
  merged?: ProseMirrorDoc;
  conflicts?: ConflictSection[];
  fallbackToTextual?: boolean;
}

export interface ConflictSection {
  path: string;
  base: any;
  mine: any;
  theirs: any;
}

/**
 * Convert ProseMirror JSON to plain text for diffing
 */
export function proseMirrorToText(doc: ProseMirrorDoc): string {
  const lines: string[] = [];
  
  function extractText(node: ProseMirrorNode | ProseMirrorDoc): void {
    if ('text' in node && node.text) {
      lines.push(node.text);
    }
    
    if (node.content) {
      for (const child of node.content) {
        extractText(child);
      }
    }
  }
  
  extractText(doc);
  return lines.join('\n');
}

/**
 * Create a text-based diff between two ProseMirror documents
 */
export function diffProseMirrorText(
  base: ProseMirrorDoc,
  mine: ProseMirrorDoc,
  theirs: ProseMirrorDoc
): DiffResult {
  const baseText = proseMirrorToText(base);
  const mineText = proseMirrorToText(mine);
  const theirsText = proseMirrorToText(theirs);
  
  const mineDiff = diffLines(baseText, mineText);
  const theirsDiff = diffLines(baseText, theirsText);
  
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  const conflicted: string[] = [];
  
  // Analyze diffs to categorize changes
  mineDiff.forEach((part, index) => {
    const theirPart = theirsDiff[index];
    
    if (part.added && (!theirPart || !theirPart.added)) {
      added.push(part.value);
    } else if (part.removed && (!theirPart || !theirPart.removed)) {
      removed.push(part.value);
    } else if (!part.added && !part.removed) {
      unchanged.push(part.value);
    } else if (part.added && theirPart?.added && part.value !== theirPart.value) {
      conflicted.push(`Mine: ${part.value}\nTheirs: ${theirPart.value}`);
    }
  });
  
  return { added, removed, unchanged, conflicted };
}

/**
 * Attempt a three-way merge of ProseMirror documents
 */
export function mergeProseMirrorDocs(
  base: ProseMirrorDoc,
  mine: ProseMirrorDoc,
  theirs: ProseMirrorDoc,
  options: { 
    preferMineOnConflict?: boolean;
    maxDocSize?: number;
  } = {}
): MergeResult {
  const { preferMineOnConflict = false, maxDocSize = 100000 } = options;
  
  // Check document size
  const docSize = JSON.stringify(mine).length + JSON.stringify(theirs).length;
  if (docSize > maxDocSize) {
    return {
      success: false,
      fallbackToTextual: true,
      conflicts: [{
        path: 'root',
        base,
        mine,
        theirs
      }]
    };
  }
  
  // Simple structural merge attempt
  try {
    const merged = mergeNodes(base, mine, theirs, '', preferMineOnConflict);
    
    if (merged.conflicts.length === 0) {
      return {
        success: true,
        merged: merged.node as ProseMirrorDoc
      };
    } else {
      return {
        success: false,
        merged: merged.node as ProseMirrorDoc,
        conflicts: merged.conflicts
      };
    }
  } catch (error) {
    // Fallback to textual diff if structural merge fails
    return {
      success: false,
      fallbackToTextual: true,
      conflicts: [{
        path: 'root',
        base,
        mine,
        theirs
      }]
    };
  }
}

/**
 * Recursive node merger
 */
function mergeNodes(
  base: any,
  mine: any,
  theirs: any,
  path: string,
  preferMineOnConflict: boolean
): { node: any; conflicts: ConflictSection[] } {
  const conflicts: ConflictSection[] = [];
  
  // Handle null/undefined cases
  if (mine === undefined || mine === null) return { node: theirs, conflicts };
  if (theirs === undefined || theirs === null) return { node: mine, conflicts };
  
  // Handle primitive values
  if (typeof mine !== 'object' || typeof theirs !== 'object') {
    if (mine === theirs) {
      return { node: mine, conflicts };
    } else if (mine === base) {
      return { node: theirs, conflicts };
    } else if (theirs === base) {
      return { node: mine, conflicts };
    } else {
      // Conflict: both changed differently
      conflicts.push({ path, base, mine, theirs });
      return { node: preferMineOnConflict ? mine : theirs, conflicts };
    }
  }
  
  // Handle arrays (like content)
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const mergedArray: any[] = [];
    const maxLen = Math.max(mine.length, theirs.length, base?.length || 0);
    
    for (let i = 0; i < maxLen; i++) {
      const baseItem = base?.[i];
      const mineItem = mine[i];
      const theirsItem = theirs[i];
      
      if (mineItem === undefined) {
        mergedArray.push(theirsItem);
      } else if (theirsItem === undefined) {
        mergedArray.push(mineItem);
      } else {
        const merged = mergeNodes(
          baseItem,
          mineItem,
          theirsItem,
          `${path}[${i}]`,
          preferMineOnConflict
        );
        mergedArray.push(merged.node);
        conflicts.push(...merged.conflicts);
      }
    }
    
    return { node: mergedArray, conflicts };
  }
  
  // Handle objects
  const merged: any = {};
  const allKeys = new Set([
    ...Object.keys(mine),
    ...Object.keys(theirs),
    ...(base ? Object.keys(base) : [])
  ]);
  
  for (const key of allKeys) {
    const baseValue = base?.[key];
    const mineValue = mine[key];
    const theirsValue = theirs[key];
    
    const mergedProp = mergeNodes(
      baseValue,
      mineValue,
      theirsValue,
      path ? `${path}.${key}` : key,
      preferMineOnConflict
    );
    
    merged[key] = mergedProp.node;
    conflicts.push(...mergedProp.conflicts);
  }
  
  return { node: merged, conflicts };
}

/**
 * Calculate a simple hash for version comparison
 */
export function calculateHash(doc: ProseMirrorDoc): string {
  const str = JSON.stringify(doc);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

/**
 * Check if two ProseMirror documents are equal
 */
export function areDocsEqual(doc1: ProseMirrorDoc, doc2: ProseMirrorDoc): boolean {
  return JSON.stringify(doc1) === JSON.stringify(doc2);
}

/**
 * Extract text content for preview
 */
export function extractPreview(doc: ProseMirrorDoc, maxLength: number = 100): string {
  const text = proseMirrorToText(doc);
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}