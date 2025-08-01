import type { InitStepType } from "@repo/db";

/**
 * Human-readable display names for initialization steps
 */
export const STEP_DISPLAY_NAMES: Record<InitStepType, string> = {
  // Local mode step
  PREPARE_WORKSPACE: "Preparing Workspace",

  // Firecracker-specific steps
  CREATE_VM: "Creating VM",
  WAIT_VM_READY: "Starting VM",
  VERIFY_VM_WORKSPACE: "Verifying Workspace",

  // Repository indexing step (both modes)
  INDEX_REPOSITORY: "Indexing Repository",

  // Cleanup step (firecracker only)
  CLEANUP_WORKSPACE: "Cleaning Up"
};

/**
 * Get all step display names in execution order for a given mode
 */
export function getStepsForMode(mode: "local" | "firecracker"): InitStepType[] {
  if (mode === "firecracker") {
    return [
      "CREATE_VM",
      "WAIT_VM_READY",
      "VERIFY_VM_WORKSPACE",
      "INDEX_REPOSITORY"
    ];
  } else {
    return [
      "PREPARE_WORKSPACE",
      "INDEX_REPOSITORY"
    ];
  }
}