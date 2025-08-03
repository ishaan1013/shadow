import type { InitStatus } from "@repo/db";

/**
 * Human-readable display names for initialization steps
 */
export const STEP_DISPLAY_NAMES: Record<InitStatus, string> = {
  INACTIVE: "Not Started",
  PREPARE_WORKSPACE: "Preparing Workspace",
  CREATE_VM: "Creating VM",
  WAIT_VM_READY: "Starting VM",
  VERIFY_VM_WORKSPACE: "Verifying Workspace",
  INDEX_REPOSITORY: "Indexing Repository",
  ACTIVE: "Ready",
};

/**
 * Get all step display names in execution order for a given mode
 */
export function getStepsForMode(mode: "local" | "remote"): InitStatus[] {
  if (mode === "remote") {
    return [
      "CREATE_VM",
      "WAIT_VM_READY",
      "VERIFY_VM_WORKSPACE",
      "INDEX_REPOSITORY",
    ];
  } else {
    return ["PREPARE_WORKSPACE", "INDEX_REPOSITORY"];
  }
}
