import { CoordinateBridge } from '../coordinate-bridge'

describe('CoordinateBridge', () => {
  describe('screenToCanvas', () => {
    it('should convert screen coordinates to canvas coordinates', () => {
      const screenPoint = { x: 100, y: 100 }
      const transform = { x: 50, y: 50, scale: 2 }
      
      const canvasPoint = CoordinateBridge.screenToCanvas(screenPoint, transform)
      
      // (100 - 50) / 2 = 25
      expect(canvasPoint).toEqual({ x: 25, y: 25 })
    })
    
    it('should handle scale of 1', () => {
      const screenPoint = { x: 200, y: 150 }
      const transform = { x: 10, y: 20, scale: 1 }
      
      const canvasPoint = CoordinateBridge.screenToCanvas(screenPoint, transform)
      
      expect(canvasPoint).toEqual({ x: 190, y: 130 })
    })
    
    it('should handle negative transforms', () => {
      const screenPoint = { x: 50, y: 50 }
      const transform = { x: -100, y: -100, scale: 0.5 }
      
      const canvasPoint = CoordinateBridge.screenToCanvas(screenPoint, transform)
      
      // (50 - (-100)) / 0.5 = 300
      expect(canvasPoint).toEqual({ x: 300, y: 300 })
    })
  })
  
  describe('canvasToScreen', () => {
    it('should convert canvas coordinates to screen coordinates', () => {
      const canvasPoint = { x: 25, y: 25 }
      const transform = { x: 50, y: 50, scale: 2 }
      
      const screenPoint = CoordinateBridge.canvasToScreen(canvasPoint, transform)
      
      // 25 * 2 + 50 = 100
      expect(screenPoint).toEqual({ x: 100, y: 100 })
    })
    
    it('should handle scale of 1', () => {
      const canvasPoint = { x: 190, y: 130 }
      const transform = { x: 10, y: 20, scale: 1 }
      
      const screenPoint = CoordinateBridge.canvasToScreen(canvasPoint, transform)
      
      expect(screenPoint).toEqual({ x: 200, y: 150 })
    })
    
    it('should handle negative canvas coordinates', () => {
      const canvasPoint = { x: -50, y: -50 }
      const transform = { x: 100, y: 100, scale: 2 }
      
      const screenPoint = CoordinateBridge.canvasToScreen(canvasPoint, transform)
      
      // -50 * 2 + 100 = 0
      expect(screenPoint).toEqual({ x: 0, y: 0 })
    })
  })
  
  describe('roundtrip conversion', () => {
    it('should maintain coordinates through roundtrip conversion', () => {
      const originalScreen = { x: 123, y: 456 }
      const transform = { x: 78, y: 90, scale: 1.5 }
      
      const canvas = CoordinateBridge.screenToCanvas(originalScreen, transform)
      const backToScreen = CoordinateBridge.canvasToScreen(canvas, transform)
      
      expect(backToScreen.x).toBeCloseTo(originalScreen.x)
      expect(backToScreen.y).toBeCloseTo(originalScreen.y)
    })
  })
  
  describe('containerTransformStyle', () => {
    it('should generate correct CSS transform string', () => {
      const transform = { x: 100, y: 200, scale: 1.5 }
      
      const style = CoordinateBridge.containerTransformStyle(transform)
      
      expect(style).toEqual({
        transform: 'translate(100px, 200px) scale(1.5)',
        transformOrigin: '0 0',
      })
    })
    
    it('should handle default scale of 1', () => {
      const transform = { x: 50, y: 75, scale: 1 }
      
      const style = CoordinateBridge.containerTransformStyle(transform)
      
      expect(style).toEqual({
        transform: 'translate(50px, 75px) scale(1)',
        transformOrigin: '0 0',
      })
    })
    
    it('should handle negative values', () => {
      const transform = { x: -100, y: -50, scale: 0.5 }
      
      const style = CoordinateBridge.containerTransformStyle(transform)
      
      expect(style).toEqual({
        transform: 'translate(-100px, -50px) scale(0.5)',
        transformOrigin: '0 0',
      })
    })
  })
  
  describe('applyTransform', () => {
    it('should apply delta to transform', () => {
      const current = { x: 100, y: 100, scale: 1 }
      const delta = { x: 50, y: -25, scale: 0.5 }
      
      const result = CoordinateBridge.applyTransform(current, delta)
      
      expect(result).toEqual({ x: 150, y: 75, scale: 1.5 })
    })
    
    it('should handle partial delta', () => {
      const current = { x: 100, y: 100, scale: 2 }
      const delta = { x: 25 }
      
      const result = CoordinateBridge.applyTransform(current, delta)
      
      expect(result).toEqual({ x: 125, y: 100, scale: 2 })
    })
    
    it('should handle empty delta', () => {
      const current = { x: 100, y: 100, scale: 1.5 }
      const delta = {}
      
      const result = CoordinateBridge.applyTransform(current, delta)
      
      expect(result).toEqual(current)
    })
  })
  
  describe('composeTransforms', () => {
    it('should compose two transforms', () => {
      const parent = { x: 100, y: 100, scale: 2 }
      const child = { x: 50, y: 50, scale: 0.5 }
      
      const composed = CoordinateBridge.composeTransforms(parent, child)
      
      // x: 100 + 50 * 2 = 200
      // y: 100 + 50 * 2 = 200
      // scale: 2 * 0.5 = 1
      expect(composed).toEqual({ x: 200, y: 200, scale: 1 })
    })
    
    it('should handle identity parent', () => {
      const parent = { x: 0, y: 0, scale: 1 }
      const child = { x: 50, y: 75, scale: 2 }
      
      const composed = CoordinateBridge.composeTransforms(parent, child)
      
      expect(composed).toEqual(child)
    })
    
    it('should handle identity child', () => {
      const parent = { x: 100, y: 200, scale: 1.5 }
      const child = { x: 0, y: 0, scale: 1 }
      
      const composed = CoordinateBridge.composeTransforms(parent, child)
      
      expect(composed).toEqual(parent)
    })
  })
  
  describe('edge cases', () => {
    it('should handle zero scale gracefully', () => {
      const screenPoint = { x: 100, y: 100 }
      const transform = { x: 50, y: 50, scale: 0 }
      
      // Should return Infinity or handle gracefully
      const canvasPoint = CoordinateBridge.screenToCanvas(screenPoint, transform)
      
      expect(canvasPoint.x).toBe(Infinity)
      expect(canvasPoint.y).toBe(Infinity)
    })
    
    it('should handle very large scales', () => {
      const screenPoint = { x: 1, y: 1 }
      const transform = { x: 0, y: 0, scale: 1000000 }
      
      const canvasPoint = CoordinateBridge.screenToCanvas(screenPoint, transform)
      
      expect(canvasPoint.x).toBeCloseTo(0.000001)
      expect(canvasPoint.y).toBeCloseTo(0.000001)
    })
    
    it('should handle very small scales', () => {
      const screenPoint = { x: 1000000, y: 1000000 }
      const transform = { x: 0, y: 0, scale: 0.000001 }
      
      const canvasPoint = CoordinateBridge.screenToCanvas(screenPoint, transform)
      
      expect(canvasPoint.x).toBeCloseTo(1000000000000)
      expect(canvasPoint.y).toBeCloseTo(1000000000000)
    })
  })
})