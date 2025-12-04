/**
 * Unit Tests: Dashboard Panel Registry
 * Part of Dashboard Implementation - Phase 5.1
 *
 * Tests panel type definitions, registry functions, and default configurations.
 */

import {
  panelTypeRegistry,
  getPanelType,
  getAllPanelTypes,
  createDefaultPanel,
  isValidPanelType,
  type PanelTypeId,
} from '@/lib/dashboard/panel-registry'

describe('Dashboard Panel Registry', () => {
  describe('panelTypeRegistry', () => {
    it('should contain all required panel types', () => {
      expect(panelTypeRegistry.note).toBeDefined()
      expect(panelTypeRegistry.continue).toBeDefined()
      expect(panelTypeRegistry.navigator).toBeDefined()
      expect(panelTypeRegistry.recent).toBeDefined()
      expect(panelTypeRegistry.quick_capture).toBeDefined()
    })

    it('should have required properties for each panel type', () => {
      const requiredFields = ['id', 'name', 'description', 'icon', 'defaultSize']

      Object.values(panelTypeRegistry).forEach(panelType => {
        requiredFields.forEach(field => {
          expect(panelType).toHaveProperty(field)
        })
      })
    })

    it('should have valid default sizes', () => {
      Object.values(panelTypeRegistry).forEach(panelType => {
        expect(panelType.defaultSize.width).toBeGreaterThan(0)
        expect(panelType.defaultSize.height).toBeGreaterThan(0)
      })
    })
  })

  describe('getPanelType', () => {
    it('should return panel type for valid IDs', () => {
      expect(getPanelType('note')).toEqual(panelTypeRegistry.note)
      expect(getPanelType('continue')).toEqual(panelTypeRegistry.continue)
      expect(getPanelType('navigator')).toEqual(panelTypeRegistry.navigator)
      expect(getPanelType('recent')).toEqual(panelTypeRegistry.recent)
      expect(getPanelType('quick_capture')).toEqual(panelTypeRegistry.quick_capture)
    })

    it('should return undefined for invalid panel type', () => {
      expect(getPanelType('invalid' as PanelTypeId)).toBeUndefined()
      expect(getPanelType('' as PanelTypeId)).toBeUndefined()
    })
  })

  describe('getAllPanelTypes', () => {
    it('should return all panel types as an array', () => {
      const allTypes = getAllPanelTypes()
      expect(Array.isArray(allTypes)).toBe(true)
      expect(allTypes.length).toBe(5)
    })

    it('should include all registered panel types', () => {
      const allTypes = getAllPanelTypes()
      const ids = allTypes.map(t => t.id)

      expect(ids).toContain('note')
      expect(ids).toContain('continue')
      expect(ids).toContain('navigator')
      expect(ids).toContain('recent')
      expect(ids).toContain('quick_capture')
    })
  })

  describe('createDefaultPanel', () => {
    it('should create a panel with specified position', () => {
      const panel = createDefaultPanel('continue', 'workspace-123', { x: 0, y: 0 })

      expect(panel).toMatchObject({
        workspaceId: 'workspace-123',
        panelType: 'continue',
        width: panelTypeRegistry.continue.defaultSize.width,
        height: panelTypeRegistry.continue.defaultSize.height,
      })
      expect(panel.positionX).toBe(0)
      expect(panel.positionY).toBe(0)
    })

    it('should apply custom position when provided', () => {
      const panel = createDefaultPanel('navigator', 'ws-1', { x: 100, y: 200 })

      expect(panel.positionX).toBe(100)
      expect(panel.positionY).toBe(200)
    })

    it('should create panels with consistent structure', () => {
      const panel1 = createDefaultPanel('recent', 'ws-1', { x: 0, y: 0 })
      const panel2 = createDefaultPanel('recent', 'ws-1', { x: 50, y: 50 })

      // Both should have the same type-based properties
      expect(panel1.panelType).toBe(panel2.panelType)
      expect(panel1.width).toBe(panel2.width)
      expect(panel1.height).toBe(panel2.height)
    })

    it('should include default config from panel type', () => {
      const panel = createDefaultPanel('quick_capture', 'ws-1', { x: 0, y: 0 })

      expect(panel.config).toBeDefined()
    })

    it('should throw for invalid panel type', () => {
      expect(() => {
        createDefaultPanel('invalid' as any, 'ws-1', { x: 0, y: 0 })
      }).toThrow('Unknown panel type')
    })
  })

  describe('isValidPanelType', () => {
    it('should return true for valid panel types', () => {
      expect(isValidPanelType('note')).toBe(true)
      expect(isValidPanelType('continue')).toBe(true)
      expect(isValidPanelType('navigator')).toBe(true)
      expect(isValidPanelType('recent')).toBe(true)
      expect(isValidPanelType('quick_capture')).toBe(true)
    })

    it('should return false for invalid panel types', () => {
      expect(isValidPanelType('invalid')).toBe(false)
      expect(isValidPanelType('')).toBe(false)
      expect(isValidPanelType('NOTE')).toBe(false)
    })
  })
})
