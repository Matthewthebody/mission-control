DO $$
DECLARE
  role_value text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_contact_role') THEN
    FOREACH role_value IN ARRAY ARRAY[
      'primary_decision_maker',
      'picture_day_prep_recipient',
      'day_before_reminder_recipient',
      'gallery_recipient',
      'contract_recipient',
      'secretary_admin_assistant',
      'internal_employee',
      'photographer',
      'production_contact',
      'csr_account_owner'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumtypid = 'client_contact_role'::regtype
          AND enumlabel = role_value
      ) THEN
        EXECUTE format('ALTER TYPE client_contact_role ADD VALUE %L', role_value);
      END IF;
    END LOOP;
  END IF;
END $$;

ALTER TABLE organization_contact
  ADD COLUMN IF NOT EXISTS office_phone text,
  ADD COLUMN IF NOT EXISTS allow_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_sms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_phone boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_consent_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sms_consent_source text,
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_opted_out_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_contact_sms_consent_status_check'
  ) THEN
    ALTER TABLE organization_contact
      ADD CONSTRAINT organization_contact_sms_consent_status_check
      CHECK (sms_consent_status IN ('unknown', 'opted_in', 'opted_out', 'not_eligible'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organization_contact_communication_flags_idx
  ON organization_contact (tenant_id, active_status, do_not_contact, allow_email, allow_sms, sms_consent_status);
