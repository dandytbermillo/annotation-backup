/**
 * UI Timing Constants
 *
 * Centralized timing values for UI interactions across the application.
 * Adjust these values to change the feel and responsiveness of the UI globally.
 */

/**
 * Preview Hover Delay (ms)
 *
 * How long to wait before closing a preview when user moves mouse away.
 * Longer delays are more forgiving but feel less responsive.
 *
 * Common values:
 * - 100ms - Very responsive, but hard to catch the preview
 * - 200ms - Slightly more forgiving, still feels responsive
 * - 300ms - More relaxed, easier to catch the preview
 * - 400ms - Very forgiving, might feel a bit slow
 * - 500ms - Maximum comfort, but noticeable delay
 *
 * Current: 500ms (Maximum comfort)
 */
export const PREVIEW_HOVER_DELAY_MS = 500;

/**
 * Folder Preview Hover Delay (ms)
 *
 * How long to wait before closing a folder preview popup.
 * Used in breadcrumb folder previews and organization tree.
 *
 * Current: 300ms (Balanced)
 */
export const FOLDER_PREVIEW_DELAY_MS = 300;

/**
 * Hover Highlight Duration (ms)
 *
 * How long the hover highlight animation lasts on popup cards.
 * Must match CSS animation duration in popup-overlay.css
 *
 * Current: 2000ms (2 seconds)
 */
export const HOVER_HIGHLIGHT_DURATION_MS = 2000;

/**
 * Toolbar Button Hover Delay (ms)
 *
 * How long to wait before opening toolbar panels when hovering over buttons.
 * Prevents accidental panel triggers when moving mouse across screen.
 *
 * Common values:
 * - 0-100ms - Too sensitive, triggers accidentally
 * - 200-300ms - Sweet spot for intentional hovers (recommended)
 * - 400-500ms - Safe but might feel slightly slow
 * - 600ms+ - Feels laggy/unresponsive
 *
 * Current: 300ms (Balanced - prevents accidents, feels responsive)
 */
export const TOOLBAR_HOVER_DELAY_MS = 300;
