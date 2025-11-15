-- Up
CREATE TABLE IF NOT EXISTS note_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Workspace',
  payload JSONB NOT NULL DEFAULT '{"schemaVersion":"1.0.0","openNotes":[],"activeNoteId":null,"camera":{"x":0,"y":0,"scale":1}}'::jsonb,
  revision UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS note_workspaces_unique_default_per_user
  ON note_workspaces(user_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS note_workspaces_open_notes_idx
  ON note_workspaces
  USING GIN ((payload->'openNotes'));

-- Down
DROP TABLE IF EXISTS note_workspaces;
