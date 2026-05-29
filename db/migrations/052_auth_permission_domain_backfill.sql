DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission_domain') THEN
    ALTER TYPE permission_domain ADD VALUE IF NOT EXISTS 'gear_assets';
    ALTER TYPE permission_domain ADD VALUE IF NOT EXISTS 'gear_kits';
    ALTER TYPE permission_domain ADD VALUE IF NOT EXISTS 'gear_custody';
    ALTER TYPE permission_domain ADD VALUE IF NOT EXISTS 'gear_service_records';
    ALTER TYPE permission_domain ADD VALUE IF NOT EXISTS 'profitability_leadership';
    ALTER TYPE permission_domain ADD VALUE IF NOT EXISTS 'profitability_employee_signals';
    ALTER TYPE permission_domain ADD VALUE IF NOT EXISTS 'profitability_imports';
  END IF;
END $$;
