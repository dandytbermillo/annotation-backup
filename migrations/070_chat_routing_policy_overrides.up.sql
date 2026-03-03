-- Migration: Create chat_routing_policy_overrides table
-- Purpose: Tenant/global configuration overrides for thresholds, margins, and safety bands
-- Reference: multi-layer-routing-reliability-implementation-annex-v3_5.md Section 3.5
--
-- PREREQUISITE: update_updated_at() function must exist (created in migration 001).

CREATE TABLE chat_routing_policy_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Tenant scope
  tenant_id text NOT NULL,

  -- Override scope level
  scope_level text NOT NULL CHECK (scope_level IN ('global_default', 'intent', 'tenant', 'tenant_intent')),

  -- Intent class (required when scope_level is 'intent' or 'tenant_intent')
  intent_class text NULL,

  -- Configuration payload (thresholds, margins, safety bands, etc.)
  override_payload jsonb NOT NULL,

  -- Config versioning
  thresholds_version text NOT NULL,
  margin_version text NOT NULL,

  -- Approval and activation
  approved_by text NOT NULL,
  is_allowlisted boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,

  -- Cross-column constraint: intent_class required for intent-scoped overrides
  CONSTRAINT ck_policy_intent_required CHECK (
    (scope_level IN ('intent', 'tenant_intent') AND intent_class IS NOT NULL)
    OR (scope_level NOT IN ('intent', 'tenant_intent') AND intent_class IS NULL)
  )
);

-- updated_at trigger (function exists from migration 001)
CREATE TRIGGER chat_routing_policy_overrides_updated_at
  BEFORE UPDATE ON chat_routing_policy_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Active overrides lookup
CREATE INDEX idx_chat_routing_policy_overrides_active
  ON chat_routing_policy_overrides (tenant_id, scope_level, is_active)
  WHERE is_active = true;

-- Documentation
COMMENT ON TABLE chat_routing_policy_overrides IS 'Configuration overrides for routing thresholds, margins, and safety bands (v3.5 multi-layer routing). Application-level enforcement rejects overrides that lower safety below minimum bands.';
COMMENT ON COLUMN chat_routing_policy_overrides.scope_level IS 'Override scope: global_default, intent (per intent class), tenant (per tenant), tenant_intent (per tenant+intent)';
COMMENT ON COLUMN chat_routing_policy_overrides.intent_class IS 'Intent class for intent-scoped overrides (action_intent or info_intent). NULL for global/tenant scope.';
COMMENT ON COLUMN chat_routing_policy_overrides.override_payload IS 'JSON config dict: confidence thresholds, near-tie margins, safety band limits, etc.';
COMMENT ON COLUMN chat_routing_policy_overrides.is_allowlisted IS 'Whether this override has been approved/allowlisted for activation';
COMMENT ON COLUMN chat_routing_policy_overrides.approved_by IS 'User or role that approved this override (audit trail)';
