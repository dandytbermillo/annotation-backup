import * as Y from 'yjs'
import { Annotation, AnnotationAnchor } from '../enhanced-yjs-provider'

export interface OverlapGroup {
  annotations: Annotation[]
  mergedRange: { start: number; end: number }
  participants: string[]
}

export interface MergedAnnotation extends Annotation {
  mergedFrom: string[]
  splitEnabled: boolean
  contributorMap: Map<string, string[]>
}

// Interval Tree implementation for efficient overlap detection
class IntervalTree<T> {
  private intervals: Array<{ start: number; end: number; data: T }> = []
  
  insert(start: number, end: number, data: T): void {
    this.intervals.push({ start, end, data })
  }
  
  search(start: number, end: number): T[] {
    return this.intervals
      .filter(interval => 
        interval.start <= end && interval.end >= start
      )
      .map(interval => interval.data)
  }
}

export class AnnotationMerger {
  constructor(private doc: Y.Doc) {}
  
  // Detect overlapping annotations using interval tree
  detectOverlaps(annotations: Annotation[]): OverlapGroup[] {
    const intervalTree = new IntervalTree<Annotation>()
    const groups: OverlapGroup[] = []
    
    // Build interval tree
    annotations.forEach(anno => {
      const start = this.getAbsolutePosition(anno.anchors.start)
      const end = this.getAbsolutePosition(anno.anchors.end)
      intervalTree.insert(start, end, anno)
    })
    
    // Find overlapping groups
    const processed = new Set<string>()
    
    annotations.forEach(anno => {
      if (processed.has(anno.id)) return
      
      const start = this.getAbsolutePosition(anno.anchors.start)
      const end = this.getAbsolutePosition(anno.anchors.end)
      const overlapping = intervalTree.search(start, end)
      
      if (overlapping.length > 1) {
        const group: OverlapGroup = {
          annotations: overlapping,
          mergedRange: this.calculateMergedRange(overlapping),
          participants: [...new Set(overlapping.map(a => a.metadata.get('userId')))]
        }
        groups.push(group)
        overlapping.forEach(a => processed.add(a.id))
      }
    })
    
    return groups
  }
  
  // Merge overlapping annotations with CRDT semantics
  mergeAnnotations(group: OverlapGroup): MergedAnnotation {
    const branches = this.doc.getMap('branches')
    
    // Generate merged annotation ID
    const mergedId = `merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Calculate consensus type (majority vote)
    const typeVotes = new Map<string, number>()
    group.annotations.forEach(anno => {
      const type = anno.type
      typeVotes.set(type, (typeVotes.get(type) || 0) + 1)
    })
    const mergedType = [...typeVotes.entries()]
      .sort((a, b) => b[1] - a[1])[0][0] as Annotation['type']
    
    // Create merged annotation
    const merged: MergedAnnotation = {
      id: mergedId,
      type: mergedType,
      sourcePanel: group.annotations[0].sourcePanel,
      targetPanel: `merged_panel_${mergedId}`,
      anchors: {
        start: this.createMergedAnchor(group.annotations.map(a => a.anchors.start)),
        end: this.createMergedAnchor(group.annotations.map(a => a.anchors.end))
      },
      metadata: this.mergeMetadata(group.annotations),
      order: this.generateMergedOrder(group.annotations),
      version: 1,
      mergedFrom: group.annotations.map(a => a.id),
      splitEnabled: true,
      contributorMap: this.buildContributorMap(group.annotations)
    }
    
    // Store merged annotation
    const mergedMap = new Y.Map()
    Object.entries(merged).forEach(([key, value]) => {
      if (key === 'metadata' || key === 'contributorMap') {
        const yMap = new Y.Map()
        if (value instanceof Map) {
          value.forEach((v, k) => yMap.set(k, v))
        }
        mergedMap.set(key, yMap)
      } else {
        mergedMap.set(key, value)
      }
    })
    
    branches.set(mergedId, mergedMap)
    
    // Mark original annotations as merged
    group.annotations.forEach(anno => {
      const branch = branches.get(anno.id)
      if (branch) {
        branch.set('mergedInto', mergedId)
        branch.set('visibility', 'merged')
      }
    })
    
    return merged
  }
  
  // Split merged annotation back to originals
  splitAnnotation(mergedId: string): Annotation[] {
    const branches = this.doc.getMap('branches')
    const merged = branches.get(mergedId)
    
    if (!merged || !merged.get('mergedFrom')) {
      throw new Error('Not a merged annotation')
    }
    
    const originalIds = merged.get('mergedFrom') as string[]
    const restoredAnnotations: Annotation[] = []
    
    // Restore original annotations
    originalIds.forEach(id => {
      const branch = branches.get(id)
      if (branch) {
        branch.set('mergedInto', null)
        branch.set('visibility', 'visible')
        restoredAnnotations.push(this.branchToAnnotation(branch, id))
      }
    })
    
    // Remove merged annotation
    branches.delete(mergedId)
    
    return restoredAnnotations
  }
  
  private createMergedAnchor(anchors: AnnotationAnchor[]): AnnotationAnchor {
    const positions = anchors.map(a => this.getAbsolutePosition(a))
    const targetPos = Math.min(...positions)
    
    // Get the content fragment
    const content = this.getContentFragment()
    
    return {
      relativePosition: Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(content, targetPos)
      ),
      fallback: {
        offset: targetPos,
        textContent: this.getTextAtPosition(targetPos, 20),
        contextBefore: this.getTextAtPosition(targetPos - 20, 20),
        contextAfter: this.getTextAtPosition(targetPos + 20, 20),
        checksum: this.calculateChecksum(targetPos)
      }
    }
  }
  
  private getAbsolutePosition(anchor: AnnotationAnchor): number {
    try {
      const pos = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(anchor.relativePosition),
        this.doc
      )
      return pos?.index || anchor.fallback.offset
    } catch {
      return anchor.fallback.offset
    }
  }
  
  private calculateMergedRange(annotations: Annotation[]): { start: number; end: number } {
    const starts = annotations.map(a => this.getAbsolutePosition(a.anchors.start))
    const ends = annotations.map(a => this.getAbsolutePosition(a.anchors.end))
    
    return {
      start: Math.min(...starts),
      end: Math.max(...ends)
    }
  }
  
  private mergeMetadata(annotations: Annotation[]): Y.Map<any> {
    const merged = new Y.Map()
    
    // Combine all metadata
    annotations.forEach(anno => {
      if (anno.metadata instanceof Y.Map) {
        anno.metadata.forEach((value, key) => {
          if (!merged.has(key)) {
            merged.set(key, value)
          }
        })
      }
    })
    
    return merged
  }
  
  private generateMergedOrder(annotations: Annotation[]): string {
    // Use the earliest order
    const orders = annotations.map(a => a.order).sort()
    return orders[0]
  }
  
  private buildContributorMap(annotations: Annotation[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    
    annotations.forEach(anno => {
      const userId = anno.metadata.get('userId') || 'unknown'
      if (!map.has(userId)) {
        map.set(userId, [])
      }
      map.get(userId)!.push(anno.id)
    })
    
    return map
  }
  
  private getTextAtPosition(position: number, length: number): string {
    // Get content from the document
    const content = this.getContentFragment()
    const text = content.toString()
    
    if (position < 0) return ''
    return text.slice(position, position + length)
  }
  
  private calculateChecksum(position: number): string {
    return position.toString(36)
  }
  
  private branchToAnnotation(branch: Y.Map<any>, id: string): Annotation {
    return {
      id,
      type: branch.get('type'),
      sourcePanel: branch.get('sourcePanel'),
      targetPanel: branch.get('targetPanel'),
      anchors: branch.get('anchors'),
      metadata: branch.get('metadata'),
      order: branch.get('order'),
      version: branch.get('version')
    }
  }
  
  private getContentFragment(): Y.XmlFragment {
    // Try to get from the first editor subdoc
    const editors = this.doc.getMap('editors')
    const firstEditor = editors.values().next().value
    
    if (firstEditor && firstEditor instanceof Y.Doc) {
      return firstEditor.getXmlFragment('content')
    }
    
    // Fallback to main doc
    return this.doc.getXmlFragment('content')
  }
} 