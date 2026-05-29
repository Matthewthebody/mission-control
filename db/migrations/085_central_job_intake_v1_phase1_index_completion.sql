CREATE INDEX IF NOT EXISTS shoot_tenant_department_date_idx
  ON shoot (tenant_id, department, shoot_date);

CREATE INDEX IF NOT EXISTS shoot_tenant_organization_date_idx
  ON shoot (tenant_id, organization_id, shoot_date)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS shoot_tenant_location_date_idx
  ON shoot (tenant_id, location_id, shoot_date)
  WHERE location_id IS NOT NULL;
