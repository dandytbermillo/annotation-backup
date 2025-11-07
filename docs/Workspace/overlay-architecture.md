# Overlay Workspace Architecture

## Overview
The popup overlay gives each workspace its own saved layout (popups, positions, inspectors) while sharing a
single tree of Knowledge Base folders. Popups reference folder IDs stored in the `items` table, and hydration
loads both the layout and the folder data when a workspace is activated.

## Key Concepts
- **Overlay Layout (per workspace)**: Stored in `overlay_layouts`. Each layout references `folderId`s that point to rows in
  `items`. Workspaces can have different popup arrangements, but the folder content is shared.
- **Knowledge Base (Global)**: The Organization sidebar is a Knowledge Base browser. It always reflects the global
  Knowledge Base tree, regardless of the active workspace. Switching workspaces only changes which overlay layout
  is loaded; it does not change the folders shown in the sidebar.
- **Workspace Scoping**: Overlay API calls send `X-Overlay-Workspace-ID` so server routes know which layout to load or
  persist. Folder fetches for the sidebar remain unscoped to keep the tree consistent.

## Architecture Rules
1. **Popup folder IDs must be valid**: Each popup descriptor must point to a folder that actually exists under the
   Knowledge Base. Hydration should fall back gracefully if a legacy layout references an out-of-scope folder.
2. **Sidebar is global**: The sidebar should never be cleared just because the user switches workspaces. It is a
   Knowledge Base navigator, not a workspace-specific tree.
3. **Workspace layouts are independent**: Dragging or saving popups affects only the current workspace layout.
4. **Workspace context matters only when opening popups**: The active workspace ID is applied only when a popup is created
   (either from a sidebar entry or via the eye icon inside another popup). Ordinary Knowledge Base actions (creating folders,
   moving notes, etc.) continue to use the global Knowledge Base.

## Workflow Summary
1. User selects a workspace via the toggle (Workspace 1, Workspace 2, etc.).
2. The overlay loads the saved layout for that workspace from `overlay_layouts`.
3. The Knowledge Base sidebar remains unchanged—it still shows the global tree.
4. Clicking a sidebar folder opens/updates a popup in the current workspace layout.

## Future Enhancements
- **Parity Seeding**: Optionally clone the baseline Knowledge Base folders into each workspace to keep layouts and data
  perfectly aligned.
- **Click-time Repair**: Offer users a “Clone into current workspace” action if a popup references an out-of-scope folder.
