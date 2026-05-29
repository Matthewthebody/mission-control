export const SHOOT_LIFECYCLE_AUTOMATION_POLICY_KEY_REGISTRY = [
  "ready_to_live_window"
] as const;

export type ShootLifecycleAutomationPolicyKey =
  (typeof SHOOT_LIFECYCLE_AUTOMATION_POLICY_KEY_REGISTRY)[number];

export interface ShootLifecycleAutomationPolicy {
  policyKey: ShootLifecycleAutomationPolicyKey;
  transitionKey: string;
  enabledByDefault: boolean;
  automationMode: "optional";
  requiredHookKeys: string[];
  description: string;
}

export const SHOOT_LIFECYCLE_AUTOMATION_POLICY_REGISTRY: Readonly<
  Record<ShootLifecycleAutomationPolicyKey, ShootLifecycleAutomationPolicy>
> = {
  ready_to_live_window: {
    policyKey: "ready_to_live_window",
    transitionKey: "start_live_shoot",
    enabledByDefault: false,
    automationMode: "optional",
    requiredHookKeys: ["live_start_window_hook"],
    description: "Allows automation to move a ready shoot live when a valid on-site clock-in or the start window indicates the day has begun."
  }
} as const;
