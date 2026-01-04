# Demo Widget

Example custom widget demonstrating task list functionality and chat integration.

## Installation

1. Open Widget Manager (via dashboard settings or floating toolbar)
2. Paste URL: `http://localhost:3000/api/widgets/demo-manifest`
3. Click Install

## Features

- **Visual UI**: Shows a task list with 3 demo items
- **Chat Integration**: Responds to commands like "show demo", "list demo items"

## Chat Commands

| Command | Description |
|---------|-------------|
| "show demo" | Opens the demo widget |
| "list demo items" | Lists items in chat preview |
| "what is in demo" | Shows demo widget content |

## Files

- `manifest.json` - Widget manifest (source of truth)
- `README.md` - This file

## API Endpoints

- `GET /api/widgets/demo-manifest` - Returns manifest for installation
- `GET /api/widgets/demo-sandbox` - Returns sandbox HTML for rendering
- `POST /api/panels/demo-widget/list` - Chat intent handler

## Development

To modify this widget:
1. Edit `manifest.json` for intent changes
2. Edit `/api/widgets/demo-sandbox/route.ts` for UI changes
3. Edit `/api/panels/demo-widget/list/route.ts` for chat response changes
