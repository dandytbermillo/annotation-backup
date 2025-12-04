import { Page, BrowserContext, expect } from '@playwright/test'

/**
 * E2E Test Utilities for Dashboard Testing
 * Part of Dashboard Implementation - Phase 5.1
 *
 * Provides helpers for dashboard-specific testing scenarios.
 */

export class DashboardTestUtils {
  constructor(
    private page: Page,
    private context: BrowserContext
  ) {}

  /**
   * Enable dashboard feature flag
   */
  async enableDashboardFeature(): Promise<void> {
    await this.page.evaluate(() => {
      const flags = JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}')
      flags['dashboard.homeDashboard'] = true
      localStorage.setItem('offlineFeatureFlags', JSON.stringify(flags))
    })
  }

  /**
   * Disable dashboard feature flag
   */
  async disableDashboardFeature(): Promise<void> {
    await this.page.evaluate(() => {
      const flags = JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}')
      flags['dashboard.homeDashboard'] = false
      localStorage.setItem('offlineFeatureFlags', JSON.stringify(flags))
    })
  }

  /**
   * Clear user preferences (simulate first run)
   */
  async clearUserPreferences(): Promise<void> {
    await this.page.evaluate(() => {
      localStorage.removeItem('lastWorkspaceId')
      localStorage.removeItem('dashboard_welcome_tooltip_seen')
      localStorage.removeItem('quickCaptureEntryId')
    })
  }

  /**
   * Set last workspace ID
   */
  async setLastWorkspaceId(workspaceId: string): Promise<void> {
    await this.page.evaluate(
      (wsId) => {
        localStorage.setItem('lastWorkspaceId', wsId)
      },
      workspaceId
    )
  }

  /**
   * Get last workspace ID
   */
  async getLastWorkspaceId(): Promise<string | null> {
    return await this.page.evaluate(() => {
      return localStorage.getItem('lastWorkspaceId')
    })
  }

  /**
   * Mark welcome tooltip as seen
   */
  async dismissWelcomeTooltip(): Promise<void> {
    await this.page.evaluate(() => {
      localStorage.setItem('dashboard_welcome_tooltip_seen', 'true')
    })
  }

  /**
   * Check if welcome tooltip was seen
   */
  async isWelcomeTooltipSeen(): Promise<boolean> {
    return await this.page.evaluate(() => {
      return localStorage.getItem('dashboard_welcome_tooltip_seen') === 'true'
    })
  }

  /**
   * Fetch dashboard info via API
   */
  async getDashboardInfo(): Promise<{
    dashboardWorkspaceId: string | null
    homeEntryId: string | null
    hasLastWorkspace: boolean
  }> {
    const response = await this.page.request.get('/api/dashboard/info')
    if (response.ok()) {
      return await response.json()
    }
    return {
      dashboardWorkspaceId: null,
      homeEntryId: null,
      hasLastWorkspace: false,
    }
  }

  /**
   * Fetch dashboard panels via API
   */
  async getDashboardPanels(): Promise<
    Array<{
      id: string
      panelType: string
      positionX: number
      positionY: number
      width: number
      height: number
      config: Record<string, unknown>
    }>
  > {
    const response = await this.page.request.get('/api/dashboard/panels')
    if (response.ok()) {
      return await response.json()
    }
    return []
  }

  /**
   * Create a quick capture note via API
   */
  async createQuickCapture(
    title: string,
    content: string,
    destinationEntryId?: string
  ): Promise<{ success: boolean; noteId?: string; error?: string }> {
    const response = await this.page.request.post('/api/dashboard/quick-capture', {
      data: {
        title,
        content,
        destinationEntryId,
      },
    })

    if (response.ok()) {
      return await response.json()
    }

    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    return { success: false, error: error.error || 'Request failed' }
  }

  /**
   * Update user preferences via API
   */
  async updatePreferences(
    preferences: Partial<{
      lastWorkspaceId: string
      quickCaptureEntryId: string
    }>
  ): Promise<boolean> {
    const response = await this.page.request.patch('/api/dashboard/preferences', {
      data: preferences,
    })
    return response.ok()
  }

  /**
   * Reset dashboard layout to defaults
   */
  async resetLayout(): Promise<{
    success: boolean
    panels?: Array<{ id: string; panelType: string }>
  }> {
    const response = await this.page.request.post('/api/dashboard/panels/reset-layout')

    if (response.ok()) {
      return await response.json()
    }
    return { success: false }
  }

  /**
   * Get recent workspaces via API
   */
  async getRecentWorkspaces(): Promise<
    Array<{
      id: string
      name: string
      updatedAt: string
    }>
  > {
    const response = await this.page.request.get('/api/dashboard/recent')
    if (response.ok()) {
      const data = await response.json()
      return data.workspaces || []
    }
    return []
  }

  /**
   * Search workspaces via API
   */
  async searchWorkspaces(
    query: string
  ): Promise<
    Array<{
      id: string
      name: string
      entryName: string
    }>
  > {
    const response = await this.page.request.get(
      `/api/dashboard/workspaces/search?q=${encodeURIComponent(query)}`
    )
    if (response.ok()) {
      const data = await response.json()
      return data.workspaces || data || []
    }
    return []
  }

  /**
   * Wait for dashboard panels to load
   */
  async waitForPanelsToLoad(timeout = 10000): Promise<void> {
    await this.page.waitForSelector('[data-panel-type]', { timeout })
  }

  /**
   * Get panel by type
   */
  async getPanelByType(
    panelType: string
  ): Promise<{ id: string; panelType: string } | null> {
    const panels = await this.getDashboardPanels()
    return panels.find((p) => p.panelType === panelType) || null
  }

  /**
   * Create a panel via API
   */
  async createPanel(panel: {
    panelType: string
    positionX: number
    positionY: number
    width: number
    height: number
    config?: Record<string, unknown>
  }): Promise<{ id: string; panelType: string } | null> {
    const response = await this.page.request.post('/api/dashboard/panels', {
      data: panel,
    })

    if (response.ok()) {
      return await response.json()
    }
    return null
  }

  /**
   * Delete a panel via API
   */
  async deletePanel(panelId: string): Promise<boolean> {
    const response = await this.page.request.delete(
      `/api/dashboard/panels/${panelId}`
    )
    return response.ok()
  }

  /**
   * Update a panel via API
   */
  async updatePanel(
    panelId: string,
    updates: Partial<{
      positionX: number
      positionY: number
      width: number
      height: number
      config: Record<string, unknown>
    }>
  ): Promise<boolean> {
    const response = await this.page.request.patch(
      `/api/dashboard/panels/${panelId}`,
      {
        data: updates,
      }
    )
    return response.ok()
  }

  /**
   * Navigate home using keyboard shortcut
   */
  async pressHomeShortcut(): Promise<void> {
    const isMac = process.platform === 'darwin'
    const modifier = isMac ? 'Meta' : 'Control'
    await this.page.keyboard.press(`${modifier}+Shift+KeyH`)
  }

  /**
   * Assert dashboard panels are seeded with defaults
   */
  async assertDefaultPanelsExist(): Promise<void> {
    const panels = await this.getDashboardPanels()
    const panelTypes = panels.map((p) => p.panelType)

    expect(panelTypes).toContain('continue')
    expect(panelTypes).toContain('navigator')
    expect(panelTypes).toContain('recent')
    expect(panelTypes).toContain('quick_capture')
  }
}

/**
 * Create dashboard test context
 */
export async function createDashboardContext(
  page: Page,
  context: BrowserContext
): Promise<DashboardTestUtils> {
  return new DashboardTestUtils(page, context)
}
