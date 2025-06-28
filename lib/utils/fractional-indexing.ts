export class FractionalIndexManager {
  private indices: Map<string, string> = new Map()
  
  generateInitialIndex(): string {
    return this.generateKeyBetween(null, null)
  }
  
  generateBetween(before: string | null, after: string | null): string {
    return this.generateKeyBetween(before, after)
  }
  
  generateAfter(index: string): string {
    return this.generateKeyBetween(index, null)
  }
  
  generateBefore(index: string): string {
    return this.generateKeyBetween(null, index)
  }
  
  // Generate index for new annotation in a list
  generateForPosition(annotations: Array<{ id: string; order: string }>, position: number): string {
    const sorted = annotations.sort((a, b) => a.order.localeCompare(b.order))
    
    if (position <= 0 || annotations.length === 0) {
      return this.generateBefore(sorted[0]?.order || null)
    } else if (position >= sorted.length) {
      return this.generateAfter(sorted[sorted.length - 1]?.order || null)
    } else {
      return this.generateBetween(
        sorted[position - 1].order,
        sorted[position].order
      )
    }
  }
  
  // Rebalance indices if they get too long
  rebalanceIndices(annotations: Array<{ id: string; order: string }>): Array<{ id: string; order: string }> {
    const sorted = annotations.sort((a, b) => a.order.localeCompare(b.order))
    const rebalanced = []
    
    let prevIndex: string | null = null
    for (let i = 0; i < sorted.length; i++) {
      const newIndex = this.generateBetween(prevIndex, null)
      rebalanced.push({
        id: sorted[i].id,
        order: newIndex
      })
      prevIndex = newIndex
    }
    
    return rebalanced
  }
  
  private generateKeyBetween(a: string | null, b: string | null): string {
    // Simple fractional indexing implementation
    if (a === null && b === null) {
      return 'a0'
    }
    
    if (a === null) {
      return this.decrementKey(b!)
    }
    
    if (b === null) {
      return this.incrementKey(a)
    }
    
    return this.midpoint(a, b)
  }
  
  private incrementKey(key: string): string {
    // Simple increment - in production use proper fractional indexing library
    const lastChar = key.slice(-1)
    const prefix = key.slice(0, -1)
    
    if (lastChar === 'z') {
      return key + 'a0'
    }
    
    const nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1)
    return prefix + nextChar
  }
  
  private decrementKey(key: string): string {
    const lastChar = key.slice(-1)
    const prefix = key.slice(0, -1) || 'a'
    
    if (lastChar === 'a' || lastChar === '0') {
      return prefix.slice(0, -1) + 'Z' + 'z'
    }
    
    const prevChar = String.fromCharCode(lastChar.charCodeAt(0) - 1)
    return prefix + prevChar
  }
  
  private midpoint(a: string, b: string): string {
    // Simple midpoint calculation
    const minLength = Math.min(a.length, b.length)
    let result = ''
    
    for (let i = 0; i < minLength; i++) {
      const aChar = a.charCodeAt(i)
      const bChar = b.charCodeAt(i)
      
      if (aChar === bChar) {
        result += a[i]
      } else {
        // Found difference, calculate midpoint
        const midChar = Math.floor((aChar + bChar) / 2)
        
        // If midpoint equals aChar, need to go deeper
        if (midChar === aChar) {
          result += a[i]
          // Add a character between a and b
          return result + this.midpoint(a.slice(i + 1) || 'a', b.slice(i + 1) || 'z')
        } else {
          result += String.fromCharCode(midChar)
          return result
        }
      }
    }
    
    // If we get here, one string is a prefix of the other
    if (a.length < b.length) {
      // a is shorter, find midpoint between a and next char of b
      return a + this.midpoint('a', b[a.length])
    } else {
      // b is shorter, append something after a
      return a + 'a5'
    }
  }
} 