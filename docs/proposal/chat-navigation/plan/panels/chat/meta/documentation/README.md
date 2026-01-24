# Chat Documentation Source

This folder contains the documentation that will be seeded into the database for
chat retrieval. Each file is a small, focused explanation that the LLM can use
for "explain" and "what is" questions.

## Structure
- concepts/: Core app concepts (home, dashboard, entry, workspace, notes, widgets, panels, canvas, floating-toolbar, chat-assistant, annotations).
- widgets/: Built-in widget descriptions (recent, quick-links, links-panel, navigator, continue, widget-manager, links-overview, quick-capture, demo-widget, category-navigator).
- actions/: Supported actions and how users can ask for them.
- glossary.md: Short definitions of common terms.

## Style Rules
- Keep each doc short and scoped to a single concept.
- Use simple headings and short paragraphs.
- Prefer concrete language the chat can reuse.
- Do not include secrets or environment details.

## Recommended Sections
- Overview
- Where it appears
- Key behaviors
- Example questions
- Related concepts

## Seeding
These files map to the DB seeding plan and retrieval phases. If you update a
file, the seeding process should update the DB via content_hash changes.
