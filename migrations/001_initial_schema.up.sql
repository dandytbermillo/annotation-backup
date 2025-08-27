-- PostgreSQL Schema for YJS Annotation System
-- Migration: 001_initial_schema.up.sql
-- Purpose: Create tables for persisting YJS state (NOT for real-time sync)
-- IMPORTANT: Awareness/presence data is ephemeral and never persisted

BEGIN;

-- Core tables matching YJS structure

-- Notes table (main documents)
CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ -- Soft delete support
);

-- YJS document updates (event sourcing pattern)
CREATE TABLE yjs_updates (
    id BIGSERIAL PRIMARY KEY,
    doc_name TEXT NOT NULL, -- Format: 'note:{uuid}' or 'panel:{uuid}'
    update BYTEA NOT NULL, -- Y.encodeStateAsUpdate binary data
    client_id TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient update retrieval
CREATE INDEX idx_yjs_updates_doc_timestamp ON yjs_updates(doc_name, timestamp DESC);

-- Branches/Annotations table
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL, -- YJS map key
    type TEXT NOT NULL CHECK (type IN ('note', 'explore', 'promote')),
    source_panel TEXT NOT NULL,
    target_panel TEXT NOT NULL,
    anchor_start BYTEA NOT NULL, -- Y.RelativePosition encoded
    anchor_end BYTEA NOT NULL, -- Y.RelativePosition encoded
    anchor_fallback JSONB NOT NULL DEFAULT '{}', -- Fallback for anchor recovery
    original_text TEXT,
    metadata JSONB DEFAULT '{}',
    "order" TEXT NOT NULL, -- Fractional index for ordering
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(note_id, branch_id)
);

-- Panels table (canvas panels)
CREATE TABLE panels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    panel_id TEXT NOT NULL, -- YJS map key
    position JSONB NOT NULL DEFAULT '{"x": 0, "y": 0}',
    dimensions JSONB NOT NULL DEFAULT '{"width": 400, "height": 300}',
    title TEXT,
    type TEXT DEFAULT 'editor',
    parent_id TEXT,
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'lazy', 'unloaded')),
    last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(note_id, panel_id)
);

-- Panel connections
CREATE TABLE connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    from_panel TEXT NOT NULL,
    to_panel TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'annotation',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Snapshots for recovery and faster loading
CREATE TABLE snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    doc_name TEXT NOT NULL,
    state BYTEA NOT NULL, -- Full YJS state snapshot
    panels TEXT[], -- Array of panel IDs included in snapshot
    checksum TEXT NOT NULL, -- For validation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_branches_note_id ON branches(note_id);
CREATE INDEX idx_branches_panels ON branches(source_panel, target_panel);
CREATE INDEX idx_panels_note_id ON panels(note_id);
CREATE INDEX idx_panels_state ON panels(state) WHERE state != 'unloaded';
CREATE INDEX idx_connections_panels ON connections(from_panel, to_panel);
CREATE INDEX idx_snapshots_note_created ON snapshots(note_id, created_at DESC);

-- Updated timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers to relevant tables
CREATE TRIGGER update_notes_updated BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    
CREATE TRIGGER update_branches_updated BEFORE UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    
CREATE TRIGGER update_panels_updated BEFORE UPDATE ON panels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add comments for documentation
COMMENT ON TABLE notes IS 'Main documents in the annotation system';
COMMENT ON TABLE yjs_updates IS 'Event-sourced YJS document updates - append only';
COMMENT ON TABLE branches IS 'Annotations/branches with YJS RelativePosition anchors';
COMMENT ON TABLE panels IS 'Canvas panels with positions and states';
COMMENT ON TABLE connections IS 'Visual connections between panels';
COMMENT ON TABLE snapshots IS 'Periodic YJS state snapshots for faster loading';

COMMENT ON COLUMN yjs_updates.update IS 'Binary YJS update data from Y.encodeStateAsUpdate';
COMMENT ON COLUMN branches.anchor_start IS 'Binary Y.RelativePosition for annotation start';
COMMENT ON COLUMN branches.anchor_end IS 'Binary Y.RelativePosition for annotation end';
COMMENT ON COLUMN branches."order" IS 'Fractional index string for conflict-free ordering';

COMMIT;