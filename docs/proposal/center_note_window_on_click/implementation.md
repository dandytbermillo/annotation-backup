# Center Note Window on Click

**Feature Slug**: center_note_window  
**Date**: 2025-09-03  
**Status**: 📝 PLANNED  
**Author**: Development Team

## Objective

Display the note window at the center of the screen when users click on any note in the note panels, improving focus and readability.

## Background

Currently, when users click on a note in the note panels, the note window appears in its last position or at a default location. Users have requested that the note window automatically center itself on the screen for better visibility and consistent user experience, especially when working with multiple notes across different panel locations.

## Acceptance Criteria

- [ ] Note window appears centered on screen when any note is clicked from panels
- [ ] Centering works correctly on different screen sizes and resolutions
- [ ] Animation is smooth and not jarring (transition time < 300ms)
- [ ] Window remains within viewport boundaries (no off-screen positioning)
- [ ] User can still manually reposition the window after it opens
- [ ] Setting to disable auto-centering if user prefers

## Implementation Tasks

- [ ] Calculate viewport dimensions and center coordinates
- [ ] Implement centering logic in note window component
- [ ] Add smooth transition animation for window positioning
- [ ] Handle edge cases for small screens or extreme aspect ratios
- [ ] Add user preference setting for auto-center behavior
- [ ] Update click handlers in note panel components
- [ ] Write unit tests for centering calculations
- [ ] Test across different devices and screen sizes

## Technical Approach

Calculate the center position using `window.innerWidth` and `window.innerHeight`, accounting for the note window's own dimensions. Use CSS transitions or Framer Motion for smooth animation. Store user preference in localStorage or user settings.

## Dependencies

- Note panel component must emit proper click events
- Window management system must support programmatic positioning
- Animation library (Framer Motion) already in project

## Risks & Mitigations

- Risk: Centering might be disruptive if user is working with multiple windows
  - Mitigation: Add preference setting to disable auto-centering
  
- Risk: Performance impact from calculating positions on every click
  - Mitigation: Cache viewport dimensions and update only on resize

## Success Metrics

- 100% of note clicks result in centered window (when enabled)
- Animation completes within 300ms
- No reported issues with window going off-screen
- User satisfaction with note accessibility improves

## Out of Scope

- Remembering individual note positions
- Multi-window layouts or tiling
- Custom positioning presets beyond center

## Notes

This feature addresses a common user pain point where notes opened from panels at screen edges are partially visible or require manual repositioning.