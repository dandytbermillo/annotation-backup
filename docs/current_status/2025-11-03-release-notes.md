# Release Notes — 2025-11-03

## Overlay Workspace Enhancements
- **Custom naming prompt**: Snapshotting (`+` button or sidebar CTA) now asks for a workspace name. Accept the suggested `Workspace N` label or enter custom text; canceling leaves the layout untouched.
- **Immediate feedback**: Save/load/delete flows surface success and error toasts, while the workspace chip shows live status messages (`Loading…`, `Saving…`, `Deleting…`).
- **Deletion safeguards**: Non-default workspaces can be removed from either the sidebar or dropdown; the default workspace stays read-only and displays a disabled delete icon with a helpful tooltip.
- **Automatic fallback**: If you delete the active workspace, the next saved layout becomes active automatically; if none remain, the overlay resets to an empty canvas.
- **Seeded workspace**: Migration `038_overlay_workspace_seed_workspace1` ships a shared “Workspace 1” snapshot, ensuring fresh databases always have at least one selectable entry.

## Demo & Documentation
- Updated `docs/workflow.md` with centralized guidance for the new workspace chip, snapshot prompt, and delete flow.
- Refreshed `docs/proposal/organization_workspace/demo.html` to reflect the latest UI (status banner, delete buttons, seeded default entry, toast preview).
