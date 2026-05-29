DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_priority_label') THEN
    CREATE TYPE shoot_priority_label AS ENUM ('standard', 'elevated', 'high_priority', 'big_shoot');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_profitability_flag') THEN
    CREATE TYPE shoot_profitability_flag AS ENUM ('favorable', 'neutral', 'watch', 'needs_review');
  END IF;
END
$$;

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS revenue_potential_score integer CHECK (revenue_potential_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS strategic_district_importance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_growth_importance_score integer CHECK (account_growth_importance_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS complexity_score integer CHECK (complexity_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS customer_history_risk_score integer CHECK (customer_history_risk_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS multi_team_coordination boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS readiness_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS future_profitability_manual shoot_profitability_flag,
  ADD COLUMN IF NOT EXISTS future_profitability_reason text,
  ADD COLUMN IF NOT EXISTS future_profitability_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS future_profitability_reviewed_by uuid REFERENCES app_user(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS shoot_readiness_owner_user_id_idx ON shoot (readiness_owner_user_id);
