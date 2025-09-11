-- Create debug logs table for tracking content persistence issues
CREATE TABLE IF NOT EXISTS debug_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  component VARCHAR(100),
  action VARCHAR(100),
  note_id UUID,
  panel_id VARCHAR(255),
  content_preview TEXT,
  metadata JSONB,
  session_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX idx_debug_logs_timestamp ON debug_logs(timestamp DESC);
CREATE INDEX idx_debug_logs_note_panel ON debug_logs(note_id, panel_id);
CREATE INDEX idx_debug_logs_session ON debug_logs(session_id);
CREATE INDEX idx_debug_logs_action ON debug_logs(action);

-- Auto-cleanup old logs after 24 hours
CREATE OR REPLACE FUNCTION cleanup_old_debug_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM debug_logs WHERE timestamp < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;