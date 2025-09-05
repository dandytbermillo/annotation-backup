# Dark Mode Implementation Plan

**Feature**: dark_mode  
**Status**: PLANNED  
**Created**: 2025-09-05  
**Source**: INITIAL.md  

## Overview

Implementation plan for adding Dark Mode functionality to the annotation system.

## Architecture Changes

### 1. Theme Provider
- Create a theme context provider for managing dark/light mode state
- Store theme preference in localStorage for persistence
- Support system preference detection

### 2. Component Updates
- Update all components to use theme-aware styling
- Use Tailwind CSS dark mode utilities (dark: prefix)
- Ensure proper color contrast ratios for accessibility

### 3. Canvas Integration
- Adapt canvas rendering for dark mode
- Update annotation panel backgrounds and borders
- Adjust text colors and selection highlights

## Implementation Tasks

### Phase 1: Core Setup
- [ ] Create theme context and provider
- [ ] Add theme toggle component
- [ ] Configure Tailwind for dark mode support
- [ ] Create theme-aware color palette

### Phase 2: Component Migration
- [ ] Update navigation components
- [ ] Update editor components (TipTap)
- [ ] Update annotation panels
- [ ] Update canvas backgrounds

### Phase 3: Persistence
- [ ] Store theme preference in localStorage
- [ ] Sync with system preference
- [ ] Add user preference to database (for logged-in users)

### Phase 4: Testing & Polish
- [ ] Test all components in both themes
- [ ] Verify accessibility standards
- [ ] Add smooth transitions between themes
- [ ] Document theme customization

## Technical Details

### Theme Context Structure
```typescript
interface ThemeContext {
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}
```

### Tailwind Configuration
```javascript
module.exports = {
  darkMode: 'class',
  // ... other config
}
```

### Component Pattern
```tsx
// Example component with dark mode support
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
  {/* Content */}
</div>
```

## Files to Modify

1. **New Files**:
   - `lib/contexts/theme-context.tsx`
   - `components/theme-toggle.tsx`
   - `lib/hooks/use-theme.ts`

2. **Modified Files**:
   - `tailwind.config.js` - Enable dark mode
   - `app/layout.tsx` - Add theme provider
   - `components/canvas/*.tsx` - Update canvas components
   - `components/editor/*.tsx` - Update editor components
   - `styles/globals.css` - Add theme variables

## Database Schema

No database changes required for Phase 1-3.

Phase 4 will add:
```sql
ALTER TABLE users ADD COLUMN theme_preference VARCHAR(10) DEFAULT 'system';
```

## Testing Strategy

1. **Unit Tests**:
   - Theme context functionality
   - Theme toggle component
   - localStorage persistence

2. **Integration Tests**:
   - Theme switching across components
   - System preference detection
   - Canvas rendering in both modes

3. **E2E Tests**:
   - Full user flow with theme switching
   - Persistence across sessions
   - Accessibility compliance

## Rollback Plan

If issues arise:
1. Remove theme toggle from UI
2. Set darkMode: false in Tailwind config
3. Remove dark: prefixes from components (can be scripted)

## Success Criteria

- [ ] Users can toggle between light and dark modes
- [ ] Theme preference persists across sessions
- [ ] All components render correctly in both themes
- [ ] No accessibility issues in either theme
- [ ] Smooth transitions between themes
- [ ] Canvas and annotations work properly in dark mode

## Next Steps

After completing this feature:
1. Consider adding more theme options (high contrast, custom themes)
2. Add theme synchronization across devices for logged-in users
3. Implement auto-dark mode based on time of day

---
Generated from INITIAL.md by Context-OS