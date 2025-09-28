import { ConnectionLineAdapter } from '@/lib/rendering/connection-line-adapter'

describe('ConnectionLineAdapter', () => {
  it('produces connection paths using canvas coordinates', () => {
    const parentId = 'parent'
    const childId = 'child'

    const popups = new Map([
      [
        parentId,
        {
          id: parentId,
          canvasPosition: { x: 100, y: 200 },
          parentId: null,
          isDragging: false,
        },
      ],
      [
        childId,
        {
          id: childId,
          canvasPosition: { x: 200, y: 320 },
          parentId,
          isDragging: false,
        },
      ],
    ])

    const paths = ConnectionLineAdapter.adaptConnectionLines(popups, false)
    expect(paths.length).toBe(1)
    expect(paths[0].d).toContain('M')
  })
})
