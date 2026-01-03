/**
 * Unit Tests: Panel Manifest Validation
 * Part of Widget Manager - Phase 2 Hardening
 *
 * Tests validateManifest() function for proper validation of PanelChatManifest objects.
 */

import {
  validateManifest,
  SUPPORTED_MANIFEST_VERSIONS,
  type PanelChatManifest,
} from '@/lib/panels/panel-manifest'

describe('Panel Manifest Validation', () => {
  // Valid manifest for reference
  const validManifest: PanelChatManifest = {
    panelId: 'test-widget',
    panelType: 'demo',
    title: 'Test Widget',
    version: '1.0',
    intents: [
      {
        name: 'test_action',
        description: 'A test action',
        examples: ['do test', 'run test'],
        handler: 'api:/api/panels/test-widget',
        permission: 'read',
      },
    ],
  }

  describe('validateManifest', () => {
    describe('valid manifests', () => {
      it('should accept a valid manifest with all required fields', () => {
        expect(validateManifest(validManifest)).toBe(true)
      })

      it('should accept manifest with multiple intents', () => {
        const manifest = {
          ...validManifest,
          intents: [
            {
              name: 'action_one',
              description: 'First action',
              examples: ['one'],
              handler: 'api:/api/test/one',
              permission: 'read' as const,
            },
            {
              name: 'action_two',
              description: 'Second action',
              examples: ['two'],
              handler: 'api:/api/test/two',
              permission: 'write' as const,
            },
          ],
        }
        expect(validateManifest(manifest)).toBe(true)
      })

      it('should accept manifest with write permission', () => {
        const manifest = {
          ...validManifest,
          intents: [
            {
              ...validManifest.intents[0],
              permission: 'write' as const,
            },
          ],
        }
        expect(validateManifest(manifest)).toBe(true)
      })

      it('should accept manifest with paramsSchema', () => {
        const manifest = {
          ...validManifest,
          intents: [
            {
              ...validManifest.intents[0],
              paramsSchema: {
                query: { type: 'string' as const, required: true },
                limit: { type: 'number' as const, default: 10 },
              },
            },
          ],
        }
        expect(validateManifest(manifest)).toBe(true)
      })
    })

    describe('invalid inputs', () => {
      it('should reject null', () => {
        expect(validateManifest(null)).toBe(false)
      })

      it('should reject undefined', () => {
        expect(validateManifest(undefined)).toBe(false)
      })

      it('should reject non-object values', () => {
        expect(validateManifest('string')).toBe(false)
        expect(validateManifest(123)).toBe(false)
        expect(validateManifest(true)).toBe(false)
        expect(validateManifest([])).toBe(false)
      })
    })

    describe('missing required fields', () => {
      it('should reject manifest without panelId', () => {
        const { panelId, ...manifest } = validManifest
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest with empty panelId', () => {
        const manifest = { ...validManifest, panelId: '' }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest without panelType', () => {
        const { panelType, ...manifest } = validManifest
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest with empty panelType', () => {
        const manifest = { ...validManifest, panelType: '' }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest without title', () => {
        const { title, ...manifest } = validManifest
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest with empty title', () => {
        const manifest = { ...validManifest, title: '' }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest without version', () => {
        const { version, ...manifest } = validManifest
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest with empty version', () => {
        const manifest = { ...validManifest, version: '' }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest without intents array', () => {
        const { intents, ...manifest } = validManifest
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject manifest with non-array intents', () => {
        const manifest = { ...validManifest, intents: {} }
        expect(validateManifest(manifest)).toBe(false)
      })
    })

    describe('version validation', () => {
      it('should reject unsupported version', () => {
        const manifest = { ...validManifest, version: '2.0' }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should accept supported versions', () => {
        for (const version of SUPPORTED_MANIFEST_VERSIONS) {
          const manifest = { ...validManifest, version }
          expect(validateManifest(manifest)).toBe(true)
        }
      })
    })

    describe('intent validation', () => {
      it('should reject intent without name', () => {
        const manifest = {
          ...validManifest,
          intents: [{ ...validManifest.intents[0], name: '' }],
        }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject intent without description', () => {
        const manifest = {
          ...validManifest,
          intents: [{ ...validManifest.intents[0], description: undefined }],
        }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject intent without examples array', () => {
        const manifest = {
          ...validManifest,
          intents: [{ ...validManifest.intents[0], examples: 'not array' as any }],
        }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject intent without handler', () => {
        const manifest = {
          ...validManifest,
          intents: [{ ...validManifest.intents[0], handler: '' }],
        }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject intent with invalid permission', () => {
        const manifest = {
          ...validManifest,
          intents: [{ ...validManifest.intents[0], permission: 'admin' as any }],
        }
        expect(validateManifest(manifest)).toBe(false)
      })
    })

    describe('API-only handler validation', () => {
      it('should reject handler without api: prefix', () => {
        const manifest = {
          ...validManifest,
          intents: [
            {
              ...validManifest.intents[0],
              handler: '/api/panels/test',
            },
          ],
        }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject handler with http: prefix', () => {
        const manifest = {
          ...validManifest,
          intents: [
            {
              ...validManifest.intents[0],
              handler: 'http://example.com/api',
            },
          ],
        }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should reject handler with function: prefix', () => {
        const manifest = {
          ...validManifest,
          intents: [
            {
              ...validManifest.intents[0],
              handler: 'function:handleAction',
            },
          ],
        }
        expect(validateManifest(manifest)).toBe(false)
      })

      it('should accept handler with api: prefix', () => {
        const manifest = {
          ...validManifest,
          intents: [
            {
              ...validManifest.intents[0],
              handler: 'api:/api/panels/test-widget/action',
            },
          ],
        }
        expect(validateManifest(manifest)).toBe(true)
      })
    })

    describe('empty intents array', () => {
      it('should accept manifest with empty intents array', () => {
        const manifest = { ...validManifest, intents: [] }
        expect(validateManifest(manifest)).toBe(true)
      })
    })
  })
})
