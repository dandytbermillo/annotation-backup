import {
  createTextAnchor,
  findAnchor,
  updateAnchors,
  mergeOverlappingAnchors,
  validateAnchor,
  type TextAnchor
} from '@/lib/utils/anchor-utils'

describe('anchor-utils (plain mode)', () => {
  test('createTextAnchor: valid bounds with context', () => {
    const text = 'Hello brave new world'
    const anchor = createTextAnchor(text, 6, 11, 3)
    expect(anchor.context.content).toBe('brave')
    expect(anchor.context.before.length).toBeGreaterThan(0)
    expect(anchor.context.after.length).toBeGreaterThan(0)
  })

  test('createTextAnchor: invalid bounds throws', () => {
    const text = 'short'
    expect(() => createTextAnchor(text, -1, 2)).toThrow()
    expect(() => createTextAnchor(text, 4, 2)).toThrow()
    expect(() => createTextAnchor(text, 0, 99)).toThrow()
  })

  test('findAnchor: unique match', () => {
    const text = 'foo ABC bar'
    const a = createTextAnchor(text, 4, 7, 2) // 'ABC'
    const updated = 'foo ABC baz'
    const pos = findAnchor(a, updated)
    expect(pos).toEqual({ start: 4, end: 7 })
  })

  test('findAnchor: ambiguous matches use context', () => {
    const text = 'xxxx test yyyy test zzzz'
    const a = createTextAnchor(text, 5, 9, 4) // first 'test' with context
    const updated = 'xxxx test yyyy test zzzz'
    const pos = findAnchor(a, updated)
    expect(pos).not.toBeNull()
  })

  test('findAnchor: content removed returns null', () => {
    const text = 'foo bar baz'
    const a = createTextAnchor(text, 4, 7) // 'bar'
    const updated = 'foo baz'
    const pos = findAnchor(a, updated)
    expect(pos).toBeNull()
  })

  test('updateAnchors: overlapping anchors handled', () => {
    const text = 'abcdefghij'
    const a1 = createTextAnchor(text, 2, 5) // cde
    const a2 = createTextAnchor(text, 4, 8) // efgh
    const updates = updateAnchors([a1, a2], text, 'abXYZfghij')
    expect(updates).toHaveLength(2)
    expect(updates[0].newStart).toBeGreaterThanOrEqual(0)
  })

  test('mergeOverlappingAnchors: merges overlaps', () => {
    const text = 'abcdefghij'
    const a1 = createTextAnchor(text, 2, 5) // cde
    const a2 = createTextAnchor(text, 4, 7) // efg
    const merged = mergeOverlappingAnchors([a1, a2])
    expect(merged).toHaveLength(1)
    expect(merged[0].start).toBe(2)
    expect(merged[0].end).toBe(7)
  })

  test('mergeOverlappingAnchors: non-overlapping preserved', () => {
    const text = 'abcdefghij'
    const a1 = createTextAnchor(text, 1, 3) // bc
    const a2 = createTextAnchor(text, 5, 7) // fg
    const merged = mergeOverlappingAnchors([a1, a2])
    expect(merged).toHaveLength(2)
  })

  test('validateAnchor: exact match', () => {
    const text = 'hello world'
    const a = createTextAnchor(text, 6, 11)
    expect(validateAnchor(a, text)).toBe(true)
  })

  test('validateAnchor: short context still validates', () => {
    const text = 'a b c d'
    const a = createTextAnchor(text, 2, 3, 1) // 'b'
    expect(validateAnchor(a, text)).toBe(true)
    expect(validateAnchor(a, 'a b x d')).toBe(true) // still finds 'b'
  })
})