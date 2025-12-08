/**
 * Quick Links Extension for TipTap
 * Part of Dashboard Implementation - Quick Links Panel TipTap Version
 *
 * Provides functionality to create and render workspace links with full entry context.
 * Supports highlight-to-link UI and internal/external link distinction.
 */

export { QuickLinksMark, type QuickLinksMarkOptions } from './quick-links-mark'
export {
  insertQuickLink,
  getSelectedText,
  isQuickLinkActive,
  hasTextSelection,
  getAllQuickLinks,
  type QuickLinkAttributes,
} from './quick-links-commands'
export {
  attachQuickLinkHoverIcon,
  type QuickLinkHoverData,
  type QuickLinkHoverOpts,
} from './quick-links-hover'
