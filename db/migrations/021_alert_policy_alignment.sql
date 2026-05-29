UPDATE dangerous_action_policy
SET minimum_authority_tier = 'director_admin'::authority_tier,
    updated_at = now()
WHERE action_code = 'hide_alert'
  AND minimum_authority_tier <> 'director_admin'::authority_tier;
