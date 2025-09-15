-- ============================================================================
-- Isolation Control System - Database Schema
-- PostgreSQL schema for tracking isolation events and user preferences
-- ============================================================================

-- Table: isolation_events
-- Tracks all isolation and restoration events for analytics and debugging
CREATE TABLE IF NOT EXISTS isolation_events (
  id SERIAL PRIMARY KEY,
  event_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  
  -- Component identification
  component_id VARCHAR(255) NOT NULL,
  component_type VARCHAR(50) NOT NULL, -- 'panel', 'calculator', 'timer', 'editor', 'dragtest'
  note_id VARCHAR(255), -- Associated note if applicable
  
  -- Event details
  event_type VARCHAR(20) NOT NULL, -- 'isolated', 'restored', 'auto_restored', 'failed'
  isolation_level VARCHAR(10), -- 'soft', 'hard', NULL for restore events
  
  -- Performance metrics at time of event
  fps_before FLOAT,
  fps_after FLOAT,
  render_time_ms FLOAT,
  health_score FLOAT,
  resource_metrics JSONB, -- Detailed resource usage
  
  -- Decision factors
  consecutive_bad_frames INTEGER,
  trigger_reason VARCHAR(100), -- 'performance', 'manual', 'memory', 'error', 'cascade'
  attribution_confidence FLOAT, -- 0.0 to 1.0, how confident we are this component was the cause
  
  -- Timing
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER, -- How long component was isolated (NULL if still isolated)
  
  -- User context
  user_id VARCHAR(255),
  session_id VARCHAR(255),
  
  -- Additional context
  metadata JSONB -- Flexible field for additional data
);

-- Indexes for common queries
CREATE INDEX idx_isolation_events_component ON isolation_events(component_id, created_at DESC);
CREATE INDEX idx_isolation_events_note ON isolation_events(note_id, created_at DESC);
CREATE INDEX idx_isolation_events_session ON isolation_events(session_id, created_at DESC);
CREATE INDEX idx_isolation_events_type ON isolation_events(event_type, created_at DESC);

-- ============================================================================

-- Table: isolation_preferences
-- User-specific preferences for isolation behavior
CREATE TABLE IF NOT EXISTS isolation_preferences (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE NOT NULL,
  
  -- Feature toggles
  auto_isolation_enabled BOOLEAN DEFAULT true,
  show_notifications BOOLEAN DEFAULT true,
  show_visual_indicators BOOLEAN DEFAULT true,
  auto_restore_enabled BOOLEAN DEFAULT true,
  
  -- Sensitivity settings
  sensitivity_level VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'custom'
  
  -- Custom thresholds (NULL uses defaults)
  custom_fps_threshold INTEGER CHECK (custom_fps_threshold BETWEEN 10 AND 60),
  custom_render_threshold_ms INTEGER CHECK (custom_render_threshold_ms BETWEEN 10 AND 200),
  custom_health_threshold FLOAT CHECK (custom_health_threshold BETWEEN 0.5 AND 10.0),
  custom_consecutive_frames INTEGER CHECK (custom_consecutive_frames BETWEEN 1 AND 10),
  
  -- Timing preferences
  cooldown_ms INTEGER DEFAULT 5000 CHECK (cooldown_ms BETWEEN 1000 AND 30000),
  restore_delay_ms INTEGER DEFAULT 2000 CHECK (restore_delay_ms BETWEEN 500 AND 10000),
  evaluation_interval_ms INTEGER DEFAULT 250 CHECK (evaluation_interval_ms BETWEEN 100 AND 1000),
  
  -- Component-specific overrides
  never_isolate TEXT[], -- Array of component IDs to never isolate
  always_isolate_first TEXT[], -- Array of component IDs to prioritize for isolation
  component_priorities JSONB, -- Map of component_id to priority level
  
  -- Resource budgets
  max_isolated_components INTEGER DEFAULT 3 CHECK (max_isolated_components BETWEEN 1 AND 10),
  max_event_listeners INTEGER DEFAULT 100,
  max_dom_nodes INTEGER DEFAULT 1000,
  max_canvas_pixels INTEGER DEFAULT 4000000,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_isolation_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_isolation_preferences_updated_at
  BEFORE UPDATE ON isolation_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_isolation_preferences_updated_at();

-- ============================================================================

-- Table: isolation_state
-- Current isolation state of components (for quick lookup)
CREATE TABLE IF NOT EXISTS isolation_state (
  component_id VARCHAR(255) PRIMARY KEY,
  
  -- Current state
  is_isolated BOOLEAN NOT NULL DEFAULT false,
  isolation_level VARCHAR(10), -- 'soft', 'hard', NULL if not isolated
  
  -- Timing
  isolated_at TIMESTAMP WITH TIME ZONE,
  cooldown_until TIMESTAMP WITH TIME ZONE,
  
  -- Metrics
  consecutive_bad_windows INTEGER DEFAULT 0,
  last_health_score FLOAT,
  last_fps FLOAT,
  
  -- References
  last_event_id UUID REFERENCES isolation_events(event_id),
  
  -- Timestamps
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick state lookups
CREATE INDEX idx_isolation_state_isolated ON isolation_state(is_isolated) WHERE is_isolated = true;

-- ============================================================================

-- Table: isolation_statistics
-- Aggregated statistics for monitoring and optimization
CREATE TABLE IF NOT EXISTS isolation_statistics (
  id SERIAL PRIMARY KEY,
  
  -- Time window
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  window_end TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Aggregated metrics
  total_isolations INTEGER DEFAULT 0,
  total_restorations INTEGER DEFAULT 0,
  avg_isolation_duration_ms FLOAT,
  max_isolation_duration_ms INTEGER,
  
  -- Performance impact
  avg_fps_improvement FLOAT,
  avg_render_time_reduction_ms FLOAT,
  
  -- Component breakdown
  isolation_by_component_type JSONB, -- Map of component_type to count
  isolation_by_trigger_reason JSONB, -- Map of trigger_reason to count
  
  -- False positive tracking
  false_positive_count INTEGER DEFAULT 0, -- Isolated then quickly restored
  false_positive_rate FLOAT, -- Percentage
  
  -- System health
  avg_global_fps FLOAT,
  avg_component_health_scores JSONB, -- Map of component_id to avg score
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for time-based queries
CREATE INDEX idx_isolation_statistics_window ON isolation_statistics(window_start DESC, window_end DESC);

-- ============================================================================

-- Table: isolation_debug_logs
-- Detailed debug information for troubleshooting
CREATE TABLE IF NOT EXISTS isolation_debug_logs (
  id SERIAL PRIMARY KEY,
  
  -- Reference
  event_id UUID REFERENCES isolation_events(event_id),
  component_id VARCHAR(255),
  
  -- Debug data
  log_level VARCHAR(20) NOT NULL, -- 'debug', 'info', 'warning', 'error'
  message TEXT NOT NULL,
  
  -- Context
  stack_trace TEXT,
  metrics_snapshot JSONB, -- Full metrics at time of log
  dom_snapshot TEXT, -- Serialized DOM structure if needed
  
  -- Timing
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for debugging
CREATE INDEX idx_isolation_debug_logs_event ON isolation_debug_logs(event_id, timestamp);
CREATE INDEX idx_isolation_debug_logs_component ON isolation_debug_logs(component_id, timestamp DESC);

-- ============================================================================
-- Functions and Procedures
-- ============================================================================

-- Function: Record isolation event and update state atomically
CREATE OR REPLACE FUNCTION record_isolation_event(
  p_component_id VARCHAR,
  p_component_type VARCHAR,
  p_event_type VARCHAR,
  p_isolation_level VARCHAR,
  p_fps_before FLOAT,
  p_health_score FLOAT,
  p_trigger_reason VARCHAR,
  p_resource_metrics JSONB,
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Insert event
  INSERT INTO isolation_events (
    component_id, component_type, event_type, isolation_level,
    fps_before, health_score, trigger_reason, resource_metrics, metadata
  ) VALUES (
    p_component_id, p_component_type, p_event_type, p_isolation_level,
    p_fps_before, p_health_score, p_trigger_reason, p_resource_metrics, p_metadata
  ) RETURNING event_id INTO v_event_id;
  
  -- Update state
  IF p_event_type = 'isolated' THEN
    INSERT INTO isolation_state (
      component_id, is_isolated, isolation_level, isolated_at, last_event_id, last_health_score
    ) VALUES (
      p_component_id, true, p_isolation_level, CURRENT_TIMESTAMP, v_event_id, p_health_score
    )
    ON CONFLICT (component_id) DO UPDATE SET
      is_isolated = true,
      isolation_level = p_isolation_level,
      isolated_at = CURRENT_TIMESTAMP,
      last_event_id = v_event_id,
      last_health_score = p_health_score,
      updated_at = CURRENT_TIMESTAMP;
      
  ELSIF p_event_type IN ('restored', 'auto_restored') THEN
    UPDATE isolation_state SET
      is_isolated = false,
      isolation_level = NULL,
      last_event_id = v_event_id,
      consecutive_bad_windows = 0,
      updated_at = CURRENT_TIMESTAMP
    WHERE component_id = p_component_id;
    
    -- Update duration in original isolation event
    UPDATE isolation_events SET
      duration_ms = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at)) * 1000
    WHERE component_id = p_component_id 
      AND event_type = 'isolated'
      AND duration_ms IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================

-- Function: Get isolation recommendations based on current metrics
CREATE OR REPLACE FUNCTION get_isolation_recommendations(
  p_session_id VARCHAR
) RETURNS TABLE (
  component_id VARCHAR,
  recommendation VARCHAR,
  confidence FLOAT,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.component_id,
    CASE 
      WHEN s.consecutive_bad_windows >= 3 THEN 'isolate'
      WHEN s.consecutive_bad_windows >= 2 THEN 'monitor'
      ELSE 'healthy'
    END as recommendation,
    CASE 
      WHEN s.consecutive_bad_windows >= 3 THEN 0.9
      WHEN s.consecutive_bad_windows >= 2 THEN 0.6
      ELSE 0.3
    END as confidence,
    CASE 
      WHEN s.last_health_score > 3 THEN 'High health score: ' || s.last_health_score::TEXT
      WHEN s.last_fps < 30 THEN 'Low FPS: ' || s.last_fps::TEXT
      ELSE 'Within normal parameters'
    END as reason
  FROM isolation_state s
  WHERE s.is_isolated = false
    AND s.consecutive_bad_windows > 0
  ORDER BY s.consecutive_bad_windows DESC, s.last_health_score DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================

-- View: Current isolation status summary
CREATE OR REPLACE VIEW v_isolation_summary AS
SELECT 
  COUNT(*) FILTER (WHERE is_isolated = true) as isolated_count,
  COUNT(*) as total_components,
  AVG(last_health_score) as avg_health_score,
  AVG(last_fps) as avg_fps,
  COUNT(*) FILTER (WHERE isolation_level = 'soft') as soft_isolated,
  COUNT(*) FILTER (WHERE isolation_level = 'hard') as hard_isolated,
  MAX(isolated_at) as last_isolation_time
FROM isolation_state;

-- ============================================================================

-- View: Recent isolation events with impact
CREATE OR REPLACE VIEW v_recent_isolation_impact AS
SELECT 
  e.component_id,
  e.component_type,
  e.event_type,
  e.isolation_level,
  e.fps_before,
  e.fps_after,
  (e.fps_after - e.fps_before) as fps_improvement,
  e.health_score,
  e.trigger_reason,
  e.created_at,
  e.duration_ms
FROM isolation_events e
WHERE e.created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
ORDER BY e.created_at DESC
LIMIT 100;

-- ============================================================================
-- Sample Data for Testing
-- ============================================================================

-- Insert default preferences for testing
INSERT INTO isolation_preferences (user_id, sensitivity_level) 
VALUES ('default-user', 'medium')
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- Maintenance
-- ============================================================================

-- Function: Clean up old debug logs (call periodically)
CREATE OR REPLACE FUNCTION cleanup_old_isolation_logs(
  p_days_to_keep INTEGER DEFAULT 7
) RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM isolation_debug_logs 
  WHERE timestamp < CURRENT_TIMESTAMP - (p_days_to_keep || ' days')::INTERVAL;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Generate isolation statistics for a time window
CREATE OR REPLACE FUNCTION generate_isolation_statistics(
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
) RETURNS VOID AS $$
BEGIN
  INSERT INTO isolation_statistics (
    window_start, window_end,
    total_isolations, total_restorations,
    avg_isolation_duration_ms, max_isolation_duration_ms,
    avg_fps_improvement,
    isolation_by_component_type,
    isolation_by_trigger_reason
  )
  SELECT 
    p_start_time, p_end_time,
    COUNT(*) FILTER (WHERE event_type = 'isolated'),
    COUNT(*) FILTER (WHERE event_type IN ('restored', 'auto_restored')),
    AVG(duration_ms),
    MAX(duration_ms),
    AVG(fps_after - fps_before),
    jsonb_object_agg(component_type, cnt) FILTER (WHERE component_type IS NOT NULL),
    jsonb_object_agg(trigger_reason, reason_cnt) FILTER (WHERE trigger_reason IS NOT NULL)
  FROM (
    SELECT *, COUNT(*) OVER (PARTITION BY component_type) as cnt,
           COUNT(*) OVER (PARTITION BY trigger_reason) as reason_cnt
    FROM isolation_events
    WHERE created_at BETWEEN p_start_time AND p_end_time
  ) e;
END;
$$ LANGUAGE plpgsql;