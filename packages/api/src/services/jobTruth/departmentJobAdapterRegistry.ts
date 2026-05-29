import type { PoolClient } from "pg";
import {
  JOB_CATEGORIES,
  type JobCategory,
  type JobDepartmentType
} from "../../domain/jobTruth/index.js";
import type {
  JobDraftInput,
  JobRecord,
  JobValidationIssue,
  SchoolJobProfileRecord,
  SportsJobProfileRecord
} from "../../types/jobTruth.js";

export type DepartmentAdapter = {
  department: Extract<JobDepartmentType, "schools" | "sports">;
  validateForPublish(input: JobDraftInput): JobValidationIssue[];
  readinessTemplates(input: JobDraftInput | JobRecord): Array<{
    section_key: string;
    label: string;
    description?: string | null;
    is_required: boolean;
    is_blocker: boolean;
    sort_order: number;
    source_template_key: string;
  }>;
  getDefaultProductionConfig(input: JobDraftInput | JobRecord): { production_type: string; title: string; proof_required: boolean };
  buildDepartmentSummary(
    job: JobRecord,
    schoolProfile: SchoolJobProfileRecord | null,
    sportsProfile: SportsJobProfileRecord | null
  ): Record<string, unknown>;
  getListColumns(): string[];
  getDetailSections(): string[];
  upsertProfile(client: PoolClient, tenantId: string, jobId: string, input: JobDraftInput): Promise<void>;
};

function requireField(value: unknown, field: string, message: string): JobValidationIssue[] {
  if (value == null || (typeof value === "string" && !value.trim())) {
    return [{ field, code: "required", message }];
  }
  return [];
}

function asCategory(value: string | null | undefined): JobCategory {
  if (value && (JOB_CATEGORIES as readonly string[]).includes(value)) {
    return value as JobCategory;
  }
  return "other";
}

function getDisplayTitle(input: JobDraftInput | JobRecord) {
  return ("title" in input ? input.title : null) ?? ("event_name" in input ? input.event_name : null) ?? "Job";
}

function getSportsProfileInput(input: JobDraftInput | JobRecord) {
  return "sports_profile" in input ? input.sports_profile ?? null : null;
}

const schoolsAdapter: DepartmentAdapter = {
  department: "schools",
  validateForPublish(input) {
    const issues: JobValidationIssue[] = [];
    issues.push(...requireField(input.school_profile?.school_type ?? input.school_profile?.grade_scope, "school_profile.school_type", "Schools publish needs school context."));
    if (input.school_profile?.id_cards_required && !input.school_profile?.advisor_sorting_required && !input.school_profile?.homeroom_sorting_required) {
      issues.push({
        field: "school_profile.advisor_sorting_required",
        code: "sorting_required",
        message: "Schools ID-card workflows need an advisor or homeroom sorting rule."
      });
    }
    return issues;
  },
  readinessTemplates(input) {
    const category = asCategory("job_category" in input ? input.job_category : null);
    return [
      {
        section_key: "client",
        label: "Organization confirmed",
        is_required: true,
        is_blocker: true,
        sort_order: 10,
        source_template_key: `${category}.organization_confirmed`
      },
      {
        section_key: "schedule",
        label: "Picture-day schedule confirmed",
        is_required: true,
        is_blocker: true,
        sort_order: 20,
        source_template_key: `${category}.schedule_confirmed`
      },
      {
        section_key: "data",
        label: "Roster and sorting ready",
        is_required: true,
        is_blocker: true,
        sort_order: 30,
        source_template_key: `${category}.roster_ready`
      },
      {
        section_key: "deliverables",
        label: "Yearbook/admin deliverables confirmed",
        is_required: true,
        is_blocker: false,
        sort_order: 40,
        source_template_key: `${category}.deliverables_confirmed`
      }
    ];
  },
  getDefaultProductionConfig(input) {
    return {
      production_type: "schools_post_processing",
      title: `${getDisplayTitle(input) ?? "School job"} production`,
      proof_required: false
    };
  },
  buildDepartmentSummary(job, schoolProfile) {
    return {
      district_id: schoolProfile?.district_id ?? null,
      school_type: schoolProfile?.school_type ?? null,
      school_year: schoolProfile?.school_year ?? null,
      grade_scope: schoolProfile?.grade_scope ?? null,
      job_category: job.job_category
    };
  },
  getListColumns() {
    return ["job_number", "title", "school_type", "grade_scope", "scheduled_start_at", "readiness_status", "staffing_status"];
  },
  getDetailSections() {
    return ["summary", "days", "readiness", "staffing", "production", "activity", "school_profile"];
  },
  async upsertProfile(client, tenantId, jobId, input) {
    const schoolProfile = input.school_profile ?? {};
    await client.query(
      `
        INSERT INTO school_job_profiles (
          job_id,
          tenant_id,
          district_id,
          school_type,
          school_year,
          grade_scope,
          roster_source,
          id_cards_required,
          yearbook_required,
          composite_required,
          admin_portal_required,
          submission_deadline,
          advisor_sorting_required,
          homeroom_sorting_required,
          data_import_mode,
          special_instructions
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (job_id)
        DO UPDATE SET
          district_id = EXCLUDED.district_id,
          school_type = EXCLUDED.school_type,
          school_year = EXCLUDED.school_year,
          grade_scope = EXCLUDED.grade_scope,
          roster_source = EXCLUDED.roster_source,
          id_cards_required = EXCLUDED.id_cards_required,
          yearbook_required = EXCLUDED.yearbook_required,
          composite_required = EXCLUDED.composite_required,
          admin_portal_required = EXCLUDED.admin_portal_required,
          submission_deadline = EXCLUDED.submission_deadline,
          advisor_sorting_required = EXCLUDED.advisor_sorting_required,
          homeroom_sorting_required = EXCLUDED.homeroom_sorting_required,
          data_import_mode = EXCLUDED.data_import_mode,
          special_instructions = EXCLUDED.special_instructions,
          updated_at = now()
      `,
      [
        jobId,
        tenantId,
        schoolProfile.district_id ?? null,
        schoolProfile.school_type ?? null,
        schoolProfile.school_year ?? null,
        schoolProfile.grade_scope ?? null,
        schoolProfile.roster_source ?? null,
        schoolProfile.id_cards_required ?? false,
        schoolProfile.yearbook_required ?? false,
        schoolProfile.composite_required ?? false,
        schoolProfile.admin_portal_required ?? false,
        schoolProfile.submission_deadline ?? null,
        schoolProfile.advisor_sorting_required ?? false,
        schoolProfile.homeroom_sorting_required ?? false,
        schoolProfile.data_import_mode ?? null,
        schoolProfile.special_instructions ?? null
      ]
    );
  }
};

const sportsAdapter: DepartmentAdapter = {
  department: "sports",
  validateForPublish(input) {
    const issues: JobValidationIssue[] = [];
    issues.push(...requireField(input.sports_profile?.sport_type, "sports_profile.sport_type", "Sports publish needs sport type."));
    issues.push(...requireField(input.sports_profile?.season, "sports_profile.season", "Sports publish needs season."));
    issues.push(...requireField(input.sports_profile?.team_structure, "sports_profile.team_structure", "Sports publish needs team structure."));
    if (input.sports_profile?.proof_required && !input.sports_profile?.approval_contact_id) {
      issues.push({
        field: "sports_profile.approval_contact_id",
        code: "approval_contact_required",
        message: "Proof-required sports jobs need an approval owner."
      });
    }
    return issues;
  },
  readinessTemplates(input) {
    const category = asCategory("job_category" in input ? input.job_category : null);
    return [
      {
        section_key: "client",
        label: "Approval owner confirmed",
        is_required: true,
        is_blocker: true,
        sort_order: 10,
        source_template_key: `${category}.approval_owner_confirmed`
      },
      {
        section_key: "schedule",
        label: "Team structure and slots confirmed",
        is_required: true,
        is_blocker: true,
        sort_order: 20,
        source_template_key: `${category}.team_structure_confirmed`
      },
      {
        section_key: "products",
        label: "Proof and specialty deliverables confirmed",
        is_required: true,
        is_blocker: false,
        sort_order: 30,
        source_template_key: `${category}.products_confirmed`
      },
      {
        section_key: "staffing",
        label: "Lead photographer assigned",
        is_required: true,
        is_blocker: true,
        sort_order: 40,
        source_template_key: `${category}.lead_assigned`
      }
    ];
  },
  getDefaultProductionConfig(input) {
    const proofRequired = getSportsProfileInput(input)?.proof_required ?? false;
    return {
      production_type: proofRequired ? "sports_proof_workflow" : "sports_post_processing",
      title: `${getDisplayTitle(input) ?? "Sports job"} production`,
      proof_required: proofRequired
    };
  },
  buildDepartmentSummary(job, _schoolProfile, sportsProfile) {
    return {
      sport_type: sportsProfile?.sport_type ?? null,
      season: sportsProfile?.season ?? null,
      team_structure: sportsProfile?.team_structure ?? null,
      estimated_team_count: sportsProfile?.estimated_team_count ?? null,
      proof_required: sportsProfile?.proof_required ?? false,
      job_category: job.job_category
    };
  },
  getListColumns() {
    return ["job_number", "title", "sport_type", "season", "scheduled_start_at", "readiness_status", "production_status", "staffing_status"];
  },
  getDetailSections() {
    return ["summary", "days", "readiness", "staffing", "production", "activity", "sports_profile"];
  },
  async upsertProfile(client, tenantId, jobId, input) {
    const sportsProfile = input.sports_profile ?? {};
    await client.query(
      `
        INSERT INTO sports_job_profiles (
          job_id,
          tenant_id,
          sport_type,
          season,
          league_name,
          division,
          team_structure,
          estimated_team_count,
          proof_required,
          approval_contact_id,
          billing_contact_id,
          revenue_share_enabled,
          revenue_share_terms_summary,
          banner_work_required,
          specialty_products_required,
          buddy_photos_required,
          sponsor_graphics_required,
          client_expectations_notes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (job_id)
        DO UPDATE SET
          sport_type = EXCLUDED.sport_type,
          season = EXCLUDED.season,
          league_name = EXCLUDED.league_name,
          division = EXCLUDED.division,
          team_structure = EXCLUDED.team_structure,
          estimated_team_count = EXCLUDED.estimated_team_count,
          proof_required = EXCLUDED.proof_required,
          approval_contact_id = EXCLUDED.approval_contact_id,
          billing_contact_id = EXCLUDED.billing_contact_id,
          revenue_share_enabled = EXCLUDED.revenue_share_enabled,
          revenue_share_terms_summary = EXCLUDED.revenue_share_terms_summary,
          banner_work_required = EXCLUDED.banner_work_required,
          specialty_products_required = EXCLUDED.specialty_products_required,
          buddy_photos_required = EXCLUDED.buddy_photos_required,
          sponsor_graphics_required = EXCLUDED.sponsor_graphics_required,
          client_expectations_notes = EXCLUDED.client_expectations_notes,
          updated_at = now()
      `,
      [
        jobId,
        tenantId,
        sportsProfile.sport_type ?? null,
        sportsProfile.season ?? null,
        sportsProfile.league_name ?? null,
        sportsProfile.division ?? null,
        sportsProfile.team_structure ?? null,
        sportsProfile.estimated_team_count ?? null,
        sportsProfile.proof_required ?? false,
        sportsProfile.approval_contact_id ?? null,
        sportsProfile.billing_contact_id ?? null,
        sportsProfile.revenue_share_enabled ?? false,
        sportsProfile.revenue_share_terms_summary ?? null,
        sportsProfile.banner_work_required ?? false,
        sportsProfile.specialty_products_required ?? false,
        sportsProfile.buddy_photos_required ?? false,
        sportsProfile.sponsor_graphics_required ?? false,
        sportsProfile.client_expectations_notes ?? null
      ]
    );
  }
};

const registry = new Map<JobDepartmentType, DepartmentAdapter>([
  ["schools", schoolsAdapter],
  ["sports", sportsAdapter]
]);

export function getDepartmentJobAdapter(department: JobDepartmentType) {
  const adapter = registry.get(department);
  if (!adapter) {
    throw new Error(`No department job adapter is registered for ${department}.`);
  }
  return adapter;
}

export function listDepartmentJobAdapters() {
  return [...registry.values()];
}
