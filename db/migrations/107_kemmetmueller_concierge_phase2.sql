ALTER TABLE global_search_index
  DROP CONSTRAINT IF EXISTS global_search_index_entity_type_check;

ALTER TABLE global_search_index
  ADD CONSTRAINT global_search_index_entity_type_check
  CHECK (
    entity_type IN (
      'organization',
      'contact',
      'location',
      'shoot',
      'production_item',
      'task',
      'note',
      'comment',
      'staffing_assignment',
      'urgent_watch_alert',
      'post_shoot_evaluation'
    )
  );

ALTER TABLE global_search_index
  ADD COLUMN IF NOT EXISTS has_notes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_alerts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_staffing_gap boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS global_search_index_tenant_flags_idx
  ON global_search_index (tenant_id, has_notes, has_alerts, has_staffing_gap, updated_at DESC);

CREATE TABLE IF NOT EXISTS global_search_saved_search (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_query text NOT NULL,
  query_text text NOT NULL,
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_pinned boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS global_search_saved_search_user_idx
  ON global_search_saved_search (tenant_id, user_id, is_pinned DESC, coalesce(last_used_at, updated_at) DESC);

CREATE INDEX IF NOT EXISTS global_search_saved_search_name_trgm_idx
  ON global_search_saved_search
  USING gin (lower(name) gin_trgm_ops);

CREATE OR REPLACE FUNCTION refresh_global_search_index_note(p_tenant_id uuid, p_note_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'note'
    AND entity_id = p_note_id
    AND NOT EXISTS (
      SELECT 1
      FROM operational_note note_row
      WHERE note_row.tenant_id = p_tenant_id
        AND note_row.id = p_note_id
    );

  INSERT INTO global_search_index (
    tenant_id,
    entity_type,
    entity_id,
    title,
    subtitle,
    body_search_text,
    status,
    department,
    org_id,
    org_name,
    owner_id,
    assignee_ids,
    related_ids,
    primary_date,
    risk_level,
    permissions_payload,
    deep_link,
    updated_at,
    activity_at,
    has_notes,
    has_alerts,
    has_staffing_gap
  )
  SELECT
    note_row.tenant_id,
    'note',
    note_row.id,
    concat(
      CASE note_row.note_type::text
        WHEN 'location_memory' THEN 'Location Memory'
        WHEN 'post_shoot_follow_up' THEN 'Post-Shoot Follow-Up'
        WHEN 'permanent_note' THEN 'Permanent Note'
        WHEN 'temporary_note' THEN 'Temporary Note'
        ELSE 'Operational Note'
      END,
      ': ',
      coalesce(shoot_row.title, shift_row.title, location_row.name, initcap(replace(alert_row.alert_type::text, '_', ' ')), 'Operational context')
    ),
    concat_ws(
      ' | ',
      coalesce(org_row.display_name, location_org.display_name, alert_org.display_name),
      coalesce(location_row.name, shoot_location.name, alert_location.name),
      initcap(replace(note_row.visibility_scope::text, '_', ' '))
    ),
    concat_ws(
      ' ',
      note_row.body,
      note_row.note_type::text,
      author.full_name,
      coalesce(shoot_row.title, shift_row.title, location_row.name, initcap(replace(alert_row.alert_type::text, '_', ' '))),
      coalesce(org_row.display_name, location_org.display_name, alert_org.display_name),
      coalesce(location_row.name, shoot_location.name, alert_location.name)
    ),
    coalesce(note_row.publication_state::text, note_row.note_type::text),
    coalesce(shoot_row.department::text, shift_row.department::text, alert_shoot.department::text),
    coalesce(shoot_row.organization_id, shift_shoot.organization_id, location_row.organization_id, alert_shoot.organization_id),
    coalesce(org_row.display_name, shift_org.display_name, location_org.display_name, alert_org.display_name),
    note_row.author_user_id,
    array_remove(
      array_cat(
        coalesce(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id)
            FROM work_shift ws
            WHERE ws.tenant_id = note_row.tenant_id
              AND ws.shoot_id = coalesce(shoot_row.id, shift_row.shoot_id, alert_row.shoot_id)
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
          ),
          ARRAY[]::uuid[]
        ),
        ARRAY[note_row.author_user_id, shift_row.assigned_user_id, shift_row.manager_user_id]::uuid[]
      ),
      null::uuid
    ),
    array_remove(
      ARRAY[
        note_row.object_id,
        shoot_row.id,
        shift_row.id,
        shift_row.shoot_id,
        location_row.id,
        location_row.organization_id,
        alert_row.id,
        alert_row.shoot_id
      ]::uuid[],
      null::uuid
    ),
    note_row.created_at,
    CASE
      WHEN note_row.visibility_scope = 'leadership_only'::operational_note_visibility_scope THEN 'high'
      WHEN note_row.pinned THEN 'warning'
      ELSE NULL
    END,
    jsonb_build_object(
      'access_model', 'note',
      'object_type', note_row.object_type::text,
      'visibility_scope', note_row.visibility_scope::text,
      'department', coalesce(shoot_row.department::text, shift_row.department::text, alert_shoot.department::text),
      'assigned_user_id', shift_row.assigned_user_id,
      'manager_user_id', shift_row.manager_user_id,
      'assigned_user_ids',
        coalesce(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id::text)
            FROM work_shift ws
            WHERE ws.tenant_id = note_row.tenant_id
              AND ws.shoot_id = coalesce(shoot_row.id, shift_row.shoot_id, alert_row.shoot_id)
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
          ),
          ARRAY[]::text[]
        ),
      'lead_user_ids',
        coalesce(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id::text)
            FROM work_shift ws
            WHERE ws.tenant_id = note_row.tenant_id
              AND ws.shoot_id = coalesce(shoot_row.id, shift_row.shoot_id, alert_row.shoot_id)
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
              AND ws.satisfies_lead_coverage = true
          ),
          ARRAY[]::text[]
        )
    ),
    CASE note_row.object_type::text
      WHEN 'shoot' THEN '#photography/shoots?shoot=' || note_row.object_id::text
      WHEN 'shift' THEN '#schedule/staffing?shift=' || note_row.object_id::text
      WHEN 'location' THEN '#directory/locations?view=locations&location=' || note_row.object_id::text || '&tab=relationships'
      WHEN 'alert' THEN '#operations/urgent-watch'
      ELSE '#search'
    END,
    note_row.updated_at,
    note_row.updated_at,
    true,
    note_row.object_type = 'alert'::operational_note_object_type,
    false
  FROM operational_note note_row
  LEFT JOIN app_user author
    ON author.id = note_row.author_user_id
  LEFT JOIN shoot shoot_row
    ON note_row.object_type = 'shoot'::operational_note_object_type
   AND shoot_row.tenant_id = note_row.tenant_id
   AND shoot_row.id = note_row.object_id
  LEFT JOIN organization org_row
    ON org_row.tenant_id = shoot_row.tenant_id
   AND org_row.id = shoot_row.organization_id
  LEFT JOIN shoot_location shoot_location
    ON shoot_location.tenant_id = shoot_row.tenant_id
   AND shoot_location.id = shoot_row.location_id
  LEFT JOIN work_shift shift_row
    ON note_row.object_type = 'shift'::operational_note_object_type
   AND shift_row.tenant_id = note_row.tenant_id
   AND shift_row.id = note_row.object_id
  LEFT JOIN shoot shift_shoot
    ON shift_shoot.tenant_id = shift_row.tenant_id
   AND shift_shoot.id = shift_row.shoot_id
  LEFT JOIN organization shift_org
    ON shift_org.tenant_id = shift_shoot.tenant_id
   AND shift_org.id = shift_shoot.organization_id
  LEFT JOIN shoot_location location_row
    ON note_row.object_type = 'location'::operational_note_object_type
   AND location_row.tenant_id = note_row.tenant_id
   AND location_row.id = note_row.object_id
  LEFT JOIN organization location_org
    ON location_org.tenant_id = location_row.tenant_id
   AND location_org.id = location_row.organization_id
  LEFT JOIN alert alert_row
    ON note_row.object_type = 'alert'::operational_note_object_type
   AND alert_row.tenant_id = note_row.tenant_id
   AND alert_row.id = note_row.object_id
  LEFT JOIN shoot alert_shoot
    ON alert_shoot.tenant_id = alert_row.tenant_id
   AND alert_shoot.id = alert_row.shoot_id
  LEFT JOIN organization alert_org
    ON alert_org.tenant_id = alert_shoot.tenant_id
   AND alert_org.id = alert_shoot.organization_id
  LEFT JOIN shoot_location alert_location
    ON alert_location.tenant_id = alert_shoot.tenant_id
   AND alert_location.id = alert_shoot.location_id
  WHERE note_row.tenant_id = p_tenant_id
    AND note_row.id = p_note_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at,
    has_notes = EXCLUDED.has_notes,
    has_alerts = EXCLUDED.has_alerts,
    has_staffing_gap = EXCLUDED.has_staffing_gap;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_comment(p_tenant_id uuid, p_comment_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'comment'
    AND entity_id = p_comment_id
    AND NOT EXISTS (
      SELECT 1
      FROM checklist_comments comment_row
      WHERE comment_row.tenant_id = p_tenant_id
        AND comment_row.id = p_comment_id
    );

  INSERT INTO global_search_index (
    tenant_id, entity_type, entity_id, title, subtitle, body_search_text, status, department, org_id, org_name,
    owner_id, assignee_ids, related_ids, primary_date, risk_level, permissions_payload, deep_link, updated_at, activity_at,
    has_notes, has_alerts, has_staffing_gap
  )
  SELECT
    comment_row.tenant_id,
    'comment',
    comment_row.id,
    concat('Checklist Comment: ', coalesce(item.label, template.name, instance.title)),
    concat_ws(' | ', template.name, instance.title, coalesce(item.label, 'General comment')),
    concat_ws(' ', comment_row.body, comment_row.visibility::text, template.name, instance.title, coalesce(item.label, '')),
    comment_row.visibility::text,
    instance.department_type::text,
    coalesce(job_row.organization_id, shoot_row.organization_id, location_row.organization_id),
    coalesce(job_org.display_name, shoot_org.display_name, location_org.display_name),
    comment_row.author_user_id,
    array_remove(ARRAY[instance.owner_user_id, instance.reviewer_user_id, instance.approver_user_id]::uuid[], null::uuid),
    array_remove(ARRAY[instance.id, instance.job_id, instance.shoot_id, instance.production_item_id, instance.location_id]::uuid[], null::uuid),
    comment_row.created_at,
    CASE WHEN comment_row.visibility = 'leadership_only'::checklist_comment_visibility_type THEN 'high' ELSE NULL END,
    jsonb_build_object(
      'access_model', 'comment',
      'visibility', comment_row.visibility::text,
      'department', instance.department_type::text,
      'principal_user_ids',
      array_remove(ARRAY[instance.owner_user_id::text, instance.reviewer_user_id::text, instance.approver_user_id::text], NULL)
    ),
    CASE
      WHEN instance.production_item_id IS NOT NULL THEN '#production?item=' || instance.production_item_id::text
      WHEN instance.job_id IS NOT NULL THEN '#jobs/' || instance.job_id::text
      WHEN instance.shoot_id IS NOT NULL THEN '#photography/shoots?shoot=' || instance.shoot_id::text
      WHEN instance.location_id IS NOT NULL THEN '#directory/locations?view=locations&location=' || instance.location_id::text || '&tab=relationships'
      ELSE '#search'
    END,
    comment_row.updated_at,
    comment_row.updated_at,
    true,
    false,
    false
  FROM checklist_comments comment_row
  JOIN checklist_instances instance
    ON instance.tenant_id = comment_row.tenant_id
   AND instance.id = comment_row.checklist_instance_id
  LEFT JOIN checklist_items item
    ON item.id = comment_row.checklist_item_id
  LEFT JOIN checklist_templates template
    ON template.id = instance.template_id
  LEFT JOIN jobs job_row
    ON job_row.tenant_id = instance.tenant_id
   AND job_row.id = instance.job_id
  LEFT JOIN organization job_org
    ON job_org.tenant_id = job_row.tenant_id
   AND job_org.id = job_row.organization_id
  LEFT JOIN shoot shoot_row
    ON shoot_row.tenant_id = instance.tenant_id
   AND shoot_row.id = instance.shoot_id
  LEFT JOIN organization shoot_org
    ON shoot_org.tenant_id = shoot_row.tenant_id
   AND shoot_org.id = shoot_row.organization_id
  LEFT JOIN shoot_location location_row
    ON location_row.tenant_id = instance.tenant_id
   AND location_row.id = instance.location_id
  LEFT JOIN organization location_org
    ON location_org.tenant_id = location_row.tenant_id
   AND location_org.id = location_row.organization_id
  WHERE comment_row.tenant_id = p_tenant_id
    AND comment_row.id = p_comment_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at,
    has_notes = EXCLUDED.has_notes,
    has_alerts = EXCLUDED.has_alerts,
    has_staffing_gap = EXCLUDED.has_staffing_gap;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_staffing_assignment(p_tenant_id uuid, p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'staffing_assignment'
    AND entity_id = p_assignment_id
    AND NOT EXISTS (
      SELECT 1
      FROM job_staff_assignments assignment_row
      WHERE assignment_row.tenant_id = p_tenant_id
        AND assignment_row.id = p_assignment_id
    );

  INSERT INTO global_search_index (
    tenant_id, entity_type, entity_id, title, subtitle, body_search_text, status, department, org_id, org_name,
    owner_id, assignee_ids, related_ids, primary_date, risk_level, permissions_payload, deep_link, updated_at, activity_at,
    has_notes, has_alerts, has_staffing_gap
  )
  SELECT
    assignment_row.tenant_id,
    'staffing_assignment',
    assignment_row.id,
    concat(coalesce(user_row.full_name, 'Assigned staff'), ' staffing assignment'),
    concat_ws(' | ', assignment_row.assignment_role, job_row.job_number, job_row.title),
    concat_ws(
      ' ',
      coalesce(user_row.full_name, ''),
      assignment_row.assignment_role,
      assignment_row.assignment_status::text,
      job_row.job_number,
      job_row.title,
      org_row.display_name,
      assignment_row.notes
    ),
    assignment_row.assignment_status::text,
    job_row.department_type::text,
    job_row.organization_id,
    org_row.display_name,
    job_row.account_owner_user_id,
    array_remove(ARRAY[assignment_row.user_id, job_row.account_owner_user_id]::uuid[], null::uuid),
    array_remove(ARRAY[assignment_row.job_id, assignment_row.job_day_id, job_row.organization_id, job_row.primary_location_id]::uuid[], null::uuid),
    COALESCE(
      CASE
        WHEN job_day_row.date IS NULL THEN NULL
        WHEN job_day_row.start_time IS NULL
          THEN (job_day_row.date::timestamp AT TIME ZONE COALESCE(NULLIF(trim(job_day_row.timezone), ''), NULLIF(trim(job_row.timezone), ''), 'America/Chicago'))
        ELSE ((job_day_row.date::timestamp + job_day_row.start_time) AT TIME ZONE COALESCE(NULLIF(trim(job_day_row.timezone), ''), NULLIF(trim(job_row.timezone), ''), 'America/Chicago'))
      END,
      job_row.scheduled_start_at
    ),
    CASE
      WHEN assignment_row.assignment_status IN ('absent'::job_assignment_status_type, 'cancelled'::job_assignment_status_type) THEN 'warning'
      ELSE NULL
    END,
    jsonb_build_object(
      'access_model', 'staffing_assignment',
      'department', job_row.department_type::text,
      'assigned_user_id', assignment_row.user_id::text,
      'owner_user_id', job_row.account_owner_user_id::text
    ),
    '#jobs/' || assignment_row.job_id::text,
    assignment_row.updated_at,
    assignment_row.updated_at,
    false,
    false,
    assignment_row.assignment_status IN ('absent'::job_assignment_status_type, 'cancelled'::job_assignment_status_type)
  FROM job_staff_assignments assignment_row
  JOIN jobs job_row
    ON job_row.tenant_id = assignment_row.tenant_id
   AND job_row.id = assignment_row.job_id
  LEFT JOIN job_days job_day_row
    ON job_day_row.tenant_id = assignment_row.tenant_id
   AND job_day_row.id = assignment_row.job_day_id
  LEFT JOIN app_user user_row
    ON user_row.id = assignment_row.user_id
  LEFT JOIN organization org_row
    ON org_row.tenant_id = job_row.tenant_id
   AND org_row.id = job_row.organization_id
  WHERE assignment_row.tenant_id = p_tenant_id
    AND assignment_row.id = p_assignment_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at,
    has_notes = EXCLUDED.has_notes,
    has_alerts = EXCLUDED.has_alerts,
    has_staffing_gap = EXCLUDED.has_staffing_gap;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_urgent_watch_alert(p_tenant_id uuid, p_watch_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'urgent_watch_alert'
    AND entity_id = p_watch_id
    AND NOT EXISTS (
      SELECT 1
      FROM urgent_watch_item item
      WHERE item.tenant_id = p_tenant_id
        AND item.id = p_watch_id
    );

  INSERT INTO global_search_index (
    tenant_id, entity_type, entity_id, title, subtitle, body_search_text, status, department, org_id, org_name,
    owner_id, assignee_ids, related_ids, primary_date, risk_level, permissions_payload, deep_link, updated_at, activity_at,
    has_notes, has_alerts, has_staffing_gap
  )
  SELECT
    item.tenant_id,
    'urgent_watch_alert',
    item.id,
    item.title,
    concat_ws(' | ', item.watch_type, item.source_module, item.source_entity_label),
    concat_ws(' ', item.title, item.summary, item.watch_type, item.source_entity_label, item.next_action_label, item.source_snapshot::text),
    item.status::text,
    item.scope_department,
    null,
    null,
    item.owner_user_id,
    array_remove(ARRAY[item.owner_user_id]::uuid[], null::uuid),
    ARRAY[]::uuid[],
    item.due_at,
    item.severity::text,
    jsonb_build_object(
      'access_model', 'urgent_watch_alert',
      'scope_department', item.scope_department,
      'owner_user_id', item.owner_user_id::text
    ),
    coalesce(nullif(item.action_hash, ''), '#operations/urgent-watch'),
    item.updated_at,
    greatest(item.updated_at, item.last_seen_at),
    false,
    true,
    lower(item.watch_type) LIKE '%staff%' OR lower(item.title) LIKE '%staff%' OR lower(item.summary) LIKE '%staff%'
  FROM urgent_watch_item item
  WHERE item.tenant_id = p_tenant_id
    AND item.id = p_watch_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at,
    has_notes = EXCLUDED.has_notes,
    has_alerts = EXCLUDED.has_alerts,
    has_staffing_gap = EXCLUDED.has_staffing_gap;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_post_shoot_evaluation(p_tenant_id uuid, p_evaluation_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'post_shoot_evaluation'
    AND entity_id = p_evaluation_id
    AND NOT EXISTS (
      SELECT 1
      FROM post_shoot_evaluation evaluation
      WHERE evaluation.tenant_id = p_tenant_id
        AND evaluation.id = p_evaluation_id
    );

  INSERT INTO global_search_index (
    tenant_id, entity_type, entity_id, title, subtitle, body_search_text, status, department, org_id, org_name,
    owner_id, assignee_ids, related_ids, primary_date, risk_level, permissions_payload, deep_link, updated_at, activity_at,
    has_notes, has_alerts, has_staffing_gap
  )
  SELECT
    evaluation.tenant_id,
    'post_shoot_evaluation',
    evaluation.id,
    concat('Post-Shoot Eval: ', coalesce(shoot_row.title, evaluation.shoot_name)),
    concat_ws(' | ', org_row.display_name, location_row.name, evaluation.photographer_name),
    concat_ws(
      ' ',
      evaluation.short_summary_note,
      evaluation.next_time_recommendation,
      evaluation.went_well,
      evaluation.remember_next_time,
      evaluation.top_watch_out,
      evaluation.location_memory_promotion_text,
      evaluation.open_comment,
      evaluation.issue_category::text,
      evaluation.staffing_change_recommendation,
      evaluation.special_gear_needed_next_time
    ),
    evaluation.eval_status::text,
    shoot_row.department::text,
    evaluation.organization_id,
    org_row.display_name,
    coalesce(evaluation.eval_owner_user_id, evaluation.photographer_user_id),
    array_remove(ARRAY[evaluation.photographer_user_id, evaluation.follow_up_owner_user_id, shift_row.manager_user_id]::uuid[], null::uuid),
    array_remove(ARRAY[evaluation.shift_id, evaluation.shoot_id, evaluation.organization_id, evaluation.location_id]::uuid[], null::uuid),
    coalesce(evaluation.submitted_at, evaluation.updated_at, evaluation.created_at),
    CASE
      WHEN evaluation.leadership_review_needed OR evaluation.major_issue_flag THEN 'critical'
      WHEN evaluation.follow_up_required THEN 'warning'
      ELSE NULL
    END,
    jsonb_build_object(
      'access_model', 'post_shoot_evaluation',
      'department', shoot_row.department::text,
      'photographer_user_id', evaluation.photographer_user_id::text,
      'manager_user_id', shift_row.manager_user_id::text,
      'assigned_user_ids',
        array_remove(ARRAY[evaluation.photographer_user_id::text, evaluation.follow_up_owner_user_id::text], NULL),
      'lead_user_ids',
        coalesce(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id::text)
            FROM work_shift ws
            WHERE ws.tenant_id = evaluation.tenant_id
              AND ws.shoot_id = evaluation.shoot_id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
              AND ws.satisfies_lead_coverage = true
          ),
          ARRAY[]::text[]
        )
    ),
    CASE
      WHEN evaluation.shoot_id IS NOT NULL THEN '#photography/shoots?shoot=' || evaluation.shoot_id::text
      WHEN evaluation.shift_id IS NOT NULL THEN '#schedule/staffing?shift=' || evaluation.shift_id::text
      ELSE '#photography'
    END,
    evaluation.updated_at,
    coalesce(evaluation.submitted_at, evaluation.updated_at, evaluation.created_at),
    true,
    false,
    evaluation.staffing_fit = 'understaffed'::post_shoot_eval_staffing_fit
  FROM post_shoot_evaluation evaluation
  LEFT JOIN shoot shoot_row
    ON shoot_row.tenant_id = evaluation.tenant_id
   AND shoot_row.id = evaluation.shoot_id
  LEFT JOIN organization org_row
    ON org_row.tenant_id = evaluation.tenant_id
   AND org_row.id = evaluation.organization_id
  LEFT JOIN shoot_location location_row
    ON location_row.tenant_id = evaluation.tenant_id
   AND location_row.id = evaluation.location_id
  LEFT JOIN work_shift shift_row
    ON shift_row.tenant_id = evaluation.tenant_id
   AND shift_row.id = evaluation.shift_id
  WHERE evaluation.tenant_id = p_tenant_id
    AND evaluation.id = p_evaluation_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at,
    has_notes = EXCLUDED.has_notes,
    has_alerts = EXCLUDED.has_alerts,
    has_staffing_gap = EXCLUDED.has_staffing_gap;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_operational_note()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_note(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_checklist_comment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_comment(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_urgent_watch_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_urgent_watch_alert(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_post_shoot_evaluation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_post_shoot_evaluation(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_job_staff_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_staffing_assignment(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  PERFORM refresh_global_search_index_job_dependents(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.job_id, OLD.job_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS global_search_index_refresh_operational_note ON operational_note;
CREATE TRIGGER global_search_index_refresh_operational_note
AFTER INSERT OR UPDATE OR DELETE ON operational_note
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_operational_note();

DROP TRIGGER IF EXISTS global_search_index_refresh_checklist_comment ON checklist_comments;
CREATE TRIGGER global_search_index_refresh_checklist_comment
AFTER INSERT OR UPDATE OR DELETE ON checklist_comments
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_checklist_comment();

DROP TRIGGER IF EXISTS global_search_index_refresh_urgent_watch_item ON urgent_watch_item;
CREATE TRIGGER global_search_index_refresh_urgent_watch_item
AFTER INSERT OR UPDATE OR DELETE ON urgent_watch_item
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_urgent_watch_item();

DROP TRIGGER IF EXISTS global_search_index_refresh_post_shoot_evaluation ON post_shoot_evaluation;
CREATE TRIGGER global_search_index_refresh_post_shoot_evaluation
AFTER INSERT OR UPDATE OR DELETE ON post_shoot_evaluation
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_post_shoot_evaluation();

SELECT refresh_global_search_index_note(tenant_id, id) FROM operational_note;
SELECT refresh_global_search_index_comment(tenant_id, id) FROM checklist_comments;
SELECT refresh_global_search_index_staffing_assignment(tenant_id, id) FROM job_staff_assignments;
SELECT refresh_global_search_index_urgent_watch_alert(tenant_id, id) FROM urgent_watch_item;
SELECT refresh_global_search_index_post_shoot_evaluation(tenant_id, id) FROM post_shoot_evaluation;
