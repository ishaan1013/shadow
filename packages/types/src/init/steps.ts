import type { InitStatus } from "@repo/db";

/**
 * Human-readable display names for initialization steps
 */
export const STEP_DISPLAY_NAMES: Record<InitStatus, string> = {
  INACTIVE: "Inactive",
  PREPARE_WORKSPACE: "Preparing Workspace",
  CREATE_VM: "Creating VM",
  WAIT_VM_READY: "Starting VM",
  VERIFY_VM_WORKSPACE: "Verifying Workspace",
  START_BACKGROUND_SERVICES: "Starting Background Services",
  INSTALL_DEPENDENCIES: "Installing Dependencies",
  FINALIZE_SETUP: "Finalizing Setup",
  ACTIVE: "Active",
};

/**
 * Get all step display names in execution order for a given mode
 */
export function getStepsForMode(mode: "local" | "remote"): InitStatus[] {
  const steps: InitStatus[] = [];
  // Background services are enabled by default and run in parallel

  if (mode === "remote") {
    steps.push(
      "CREATE_VM",
      "WAIT_VM_READY",
      "VERIFY_VM_WORKSPACE",
      "START_BACKGROUND_SERVICES",
      "INSTALL_DEPENDENCIES",
      "FINALIZE_SETUP"
    );
  } else {
    steps.push(
      "PREPARE_WORKSPACE",
      "START_BACKGROUND_SERVICES",
      "INSTALL_DEPENDENCIES",
      "FINALIZE_SETUP"
    );
  }

  return steps;
}
