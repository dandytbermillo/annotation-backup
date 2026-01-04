# Demo Widget

Example custom widget demonstrating chat integration.

## Installation (From File)

1. Open Widget Manager
2. Click **From File**
3. Select this file: `manifest.json`
4. Widget will be installed and appear in CUSTOM WIDGETS list

## Chat Commands

| Command | Description |
|---------|-------------|
| "show demo" | Shows demo items in chat |
| "list demo items" | Lists all demo items |
| "what is in demo" | Shows demo widget content |

## How It Works

1. `manifest.json` defines the widget metadata and chat intents
2. When installed, manifest is stored in `installed_widgets` table
3. Chat loads enabled widget manifests from DB
4. LLM matches user input to widget intents
5. Intent handler (`/api/panels/demo-widget/list`) returns data

## Files

- `manifest.json` - Widget manifest (upload this to install)
- `README.md` - This documentation

## Note

This is a **chat-only** widget (no sandbox UI). For widgets with visual UI, add a `sandbox` section to the manifest with an HTTPS entrypoint URL.
