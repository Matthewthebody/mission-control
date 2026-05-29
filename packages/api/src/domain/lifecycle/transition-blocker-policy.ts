export const TRANSITION_BLOCKER_POLICY = {
  mark_confirmed_shoot_ready: ["ready_eligibility_guard"],
  start_live_shoot: [],
  finish_post_production: ["completion_readiness_guard"]
} as const;
