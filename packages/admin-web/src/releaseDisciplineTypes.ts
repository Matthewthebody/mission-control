export type ReleaseDisciplineSummary = {
  git: {
    checked_at: string;
    branch: string | null;
    head_sha: string | null;
    is_clean: boolean;
    dirty_path_count: number;
    dirty_paths: string[];
    error: string | null;
  };
  runtime_smoke: {
    path: string;
    exists: boolean;
    passed: boolean;
    attested_at: string | null;
    commit_sha: string | null;
    core_endpoints_ok: boolean;
    core_endpoints: Array<{
      route_path: string;
      ok: boolean;
      status: number | null;
    }>;
    error: string | null;
    commit_matches_head: boolean;
  };
  pilot_mode: {
    enabled: boolean;
    eligible: boolean;
    blockers: string[];
  };
  release_ready: boolean;
};

export type HealthStatusPayload = {
  ok: boolean;
  release_discipline?: ReleaseDisciplineSummary;
};
