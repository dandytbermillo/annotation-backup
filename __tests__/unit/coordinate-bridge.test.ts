import { CoordinateBridge } from '@/lib/utils/coordinate-bridge'

describe('CoordinateBridge', () => {
  const transform = { x: 120, y: -40, scale: 1.5 }

  it('converts screen to canvas and back consistently', () => {
    const screenPoint = { x: 150, y: 30 }
    const canvasPoint = CoordinateBridge.screenToCanvas(screenPoint, transform)
    const roundTrip = CoordinateBridge.canvasToScreen(canvasPoint, transform)

    expect(canvasPoint.x).toBeCloseTo((screenPoint.x - transform.x) / transform.scale)
    expect(canvasPoint.y).toBeCloseTo((screenPoint.y - transform.y) / transform.scale)
    expect(roundTrip.x).toBeCloseTo(screenPoint.x)
    expect(roundTrip.y).toBeCloseTo(screenPoint.y)
  })

  it('calculates container transform style from transform', () => {
    const style = CoordinateBridge.containerTransformStyle(transform)
    expect(style.transform).toBe(`translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`)
  })
})
