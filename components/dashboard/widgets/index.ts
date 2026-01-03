/**
 * Dashboard Widgets
 * macOS-style compact, read-only summary components
 */

export {
  BaseWidget,
  WidgetLabel,
  WidgetValue,
  WidgetSubtitle,
  WidgetList,
  WidgetListItem,
  WidgetListItemGradient,
  WidgetEmpty,
  WidgetContent,
  WidgetPreview,
  WidgetFooter,
} from './BaseWidget'

export type { BaseWidgetProps } from './BaseWidget'

// Widget components (added as they are created)
export { RecentWidget } from './RecentWidget'
export { QuickLinksWidget } from './QuickLinksWidget'
export { DemoWidget } from './DemoWidget'
export { WidgetManager } from './WidgetManager'
