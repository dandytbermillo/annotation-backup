# Canvas – Center Existing Notes Toggle

Use the `NEXT_PUBLIC_CANVAS_CENTER_EXISTING_NOTES` flag to control whether previously saved notes spawn at the live viewport center or at their persisted coordinates.

## Values
- `enabled` (default): existing notes open at the viewport center using the current camera snapshot. Persisted coordinates stay in storage so users can click the new “Restore position” control in the panel header to animate back to their saved layout.
- `disabled`: reverts to legacy behavior where the workspace position is honored immediately and the restore affordance is hidden.

## Usage
```bash
# Force legacy positioning
NEXT_PUBLIC_CANVAS_CENTER_EXISTING_NOTES=disabled npm run dev
```

QA tip: keep the flag enabled while verifying the centered flow, then flip it to `disabled` to confirm that the main panel returns to persisted positions without showing the 📍 button.
