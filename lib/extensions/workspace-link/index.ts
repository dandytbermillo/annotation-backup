/**
 * Workspace Link Extension for TipTap
 * Part of Dashboard Implementation - Phase 3.3
 *
 * Provides functionality to create and render workspace links in notes.
 * Supports both [[workspace:Name]] syntax and highlight-to-link UI.
 */

export { WorkspaceLink, type WorkspaceLinkOptions } from './workspace-link-mark'
export { WorkspaceLinkInputRule } from './workspace-link-input-rule'
export {
  insertWorkspaceLink,
  getSelectedText,
  isWorkspaceLinkActive,
  type WorkspaceLinkAttributes,
} from './workspace-link-commands'
