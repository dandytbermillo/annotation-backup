# Widget Styling Specifications

**Reference:** macOS Widget Design + HTML Demo
**Date:** 2026-01-01

## Design Tokens

### Colors

```css
:root {
  /* Backgrounds */
  --widget-bg: #1e222a;
  --widget-bg-hover: #252830;
  --widget-bg-input: #12141a;
  --canvas-bg: #0a0c10;

  /* Borders */
  --widget-border: rgba(255, 255, 255, 0.1);
  --widget-border-hover: rgba(99, 102, 241, 0.5);

  /* Text */
  --text-primary: #f0f0f0;
  --text-secondary: #8b8fa3;
  --text-muted: #5c6070;

  /* Accent */
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-dim: rgba(99, 102, 241, 0.15);

  /* Shadows */
  --widget-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  --widget-shadow-hover: 0 8px 32px rgba(0, 0, 0, 0.5);
}
```

### Typography

```css
/* Widget label (category text) */
.widget-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

/* Widget primary value (big number) */
.widget-value {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
}

.widget-value-unit {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: 4px;
}

/* Widget subtitle */
.widget-subtitle {
  font-size: 13px;
  color: var(--accent);
  margin-top: 4px;
}

/* List item text */
.widget-list-text {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

---

## Base Widget Component

### Container

```css
.base-widget {
  background: var(--widget-bg);
  border: 1px solid var(--widget-border);
  border-radius: 20px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
}

.base-widget:hover {
  border-color: var(--widget-border-hover);
  box-shadow: var(--widget-shadow-hover);
  transform: scale(1.02);
}

.base-widget:active {
  transform: scale(0.98);
}
```

### Size Variants

```css
/* Grid-aligned sizes */
.widget-small {
  width: 154px;
  height: 154px;
}

.widget-medium {
  width: 324px;
  height: 154px;
}

.widget-tall {
  width: 154px;
  height: 324px;
}

.widget-large {
  width: 324px;
  height: 324px;
}
```

---

## Widget List Component

```css
.widget-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.widget-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.widget-list-icon {
  width: 24px;
  height: 24px;
  background: var(--widget-bg-hover);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  color: var(--text-secondary);
}

/* Icon with gradient (for workspaces) */
.widget-list-icon.gradient {
  background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
  color: white;
}
```

---

## Specific Widget Styles

### Recent Widget (Stat Style)

```jsx
<div className="base-widget widget-small">
  <div className="widget-label">RECENT</div>
  <div className="widget-value">
    5<span className="widget-value-unit">items</span>
  </div>
  <div className="widget-content">
    <ul className="widget-list">
      <li className="widget-list-item">
        <div className="widget-list-icon gradient">W</div>
        <span className="widget-list-text">workspace33</span>
      </li>
      {/* ... 2 more items */}
    </ul>
  </div>
</div>
```

### Quick Links Widget (List Style)

```jsx
<div className="base-widget widget-small">
  <div className="widget-label">QUICK LINKS A</div>
  <ul className="widget-list">
    <li className="widget-list-item">
      <div className="widget-list-icon">📁</div>
      <span className="widget-list-text">Project Alpha</span>
    </li>
    {/* ... 3 more items */}
  </ul>
</div>
```

### Reminders Widget (Centered Stat)

```jsx
<div className="base-widget widget-small" style={{ textAlign: 'center' }}>
  <div className="widget-value">0</div>
  <div className="widget-subtitle">Reminders</div>
  <div className="widget-empty">All Completed</div>
</div>
```

```css
.widget-empty {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  padding: 20px 0;
}
```

### Calendar Widget (Date Style)

```jsx
<div className="base-widget widget-medium">
  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
    <div>
      <div className="widget-date-month">JANUARY</div>
      <div className="widget-value">1</div>
      <div className="widget-date-day">Wednesday</div>
    </div>
    <div className="widget-date-meta">2 events</div>
  </div>
</div>
```

```css
.widget-date-month {
  font-size: 11px;
  font-weight: 600;
  color: #ef4444; /* Red like macOS calendar */
  text-transform: uppercase;
}

.widget-date-day {
  font-size: 12px;
  color: var(--text-muted);
}

.widget-date-meta {
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
}
```

### Notes Widget (Content Preview)

```jsx
<div className="base-widget widget-medium">
  <div className="widget-label">NOTES</div>
  <p className="widget-preview">
    Meeting notes from today's standup. Need to follow up on the API integration timeline...
  </p>
</div>
```

```css
.widget-preview {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-top: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

---

## Full Panel Drawer (Right-Side, NOT Full-Screen Modal)

**IMPORTANT:** This is a right-side drawer that keeps widgets and chat visible.

### Backdrop (Left Side Only)

```css
.drawer-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 420px;  /* Don't cover drawer area */
  bottom: 0;
  background: rgba(0, 0, 0, 0.2);
  z-index: 99990;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.drawer-backdrop.open {
  opacity: 1;
  pointer-events: auto;  /* Clickable to close drawer */
}
```

### Drawer Container

```css
.full-panel-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;  /* Or 35vw for responsive */
  background: var(--widget-bg);
  border-left: 1px solid var(--widget-border);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  z-index: 99995;  /* Below chat (99999), above backdrop (99990) */
  transform: translateX(100%);
  transition: transform 0.3s ease;
}

.full-panel-drawer.open {
  transform: translateX(0);
}
```

### Drawer Header

```css
.drawer-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--widget-border);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.drawer-close {
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--widget-border);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  transition: all 0.15s;
}

.drawer-close:hover {
  background: var(--widget-bg-hover);
  color: var(--text-primary);
}

.drawer-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
```

### Drawer Body

```css
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
```

### Z-Index Layering

```
Drawer backdrop:     99990  (left side only, clickable to close)
Full panel drawer:   99995  (right side)
Chat panel:          99999  (floats above everything)
```

### Layout Diagram

```
┌────────────────────────────────┬──────────────┐
│                                │              │
│   Dashboard (widgets visible)  │  Full Panel  │
│                                │   Drawer     │
│   ┌─────┐  ┌─────┐  ┌─────┐   │   (420px)    │
│   │     │  │     │  │     │   │              │
│   └─────┘  └─────┘  └─────┘   │              │
│                                │              │
│   (subtle dim - 20% opacity)   │              │
│                                │              │
└────────────────────────────────┴──────────────┘
        Chat floats above all (z-index 99999)
```

---

## Tailwind CSS Equivalent

If using Tailwind, here are the equivalent classes:

```jsx
// Base Widget
<div className="bg-[#1e222a] border border-white/10 rounded-[20px] p-4
               cursor-pointer transition-all duration-200
               hover:border-indigo-500/50 hover:shadow-2xl hover:scale-[1.02]
               active:scale-[0.98]">

// Widget Label
<div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">

// Widget Value
<div className="text-[32px] font-bold text-white leading-tight">

// Widget List Item
<li className="flex items-center gap-2.5 py-1.5">

// Widget List Icon
<div className="w-6 h-6 bg-[#252830] rounded-md flex items-center justify-center
               text-[11px] font-semibold flex-shrink-0">

// Drawer Backdrop (left side only)
<div className="fixed top-0 left-0 bottom-0 right-[420px] bg-black/20
               z-[99990] transition-opacity duration-300">

// Drawer Container
<div className="fixed top-0 right-0 bottom-0 w-[420px] bg-[#1e222a]
               border-l border-white/10 shadow-2xl flex flex-col
               z-[99995] translate-x-full transition-transform duration-300
               data-[open=true]:translate-x-0">
```

---

## Animation Specs

### Widget Hover

```css
.base-widget {
  transition: all 0.2s ease;
}

.base-widget:hover {
  transform: scale(1.02);
}

.base-widget:active {
  transform: scale(0.98);
}
```

### Drawer Slide In/Out

```css
.drawer-backdrop {
  transition: opacity 0.3s ease;
}

.full-panel-drawer {
  transition: transform 0.3s ease;
}

/* Closed state */
.drawer-backdrop {
  opacity: 0;
  pointer-events: none;
}
.full-panel-drawer {
  transform: translateX(100%);
}

/* Open state */
.drawer-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}
.full-panel-drawer.open {
  transform: translateX(0);
}
```

---

## Accessibility Notes

1. **Focus management:** When drawer opens, focus should move to drawer content
2. **Escape key:** Should close drawer
3. **Click on backdrop:** Should close drawer
4. **ARIA attributes:**
   ```jsx
   <div
     role="dialog"
     aria-modal="true"
     aria-labelledby="drawer-title"
   >
   ```
5. **Keyboard navigation:** Tab should cycle within drawer when open
6. **Chat accessibility:** Chat must remain accessible even when drawer is open (z-index ensures this)

---

## Reference Implementation

See the interactive HTML demo:
`docs/proposal/components/workspace/note/plan/enhance/ui/dashboard-v5-summary-full-panels.html`
