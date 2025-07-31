export const RESIZABLE_TASK_COOKIE_NAMES = {
  taskLayout: "resizable-task-layout",
  agentEnvironment: "resizable-agent-environment",
} as const;

export type ResizableTaskCookieName = keyof typeof RESIZABLE_TASK_COOKIE_NAMES;

export const GIT_SELECTOR_COOKIE_NAME = "git-selector-state";
export const MODEL_SELECTOR_COOKIE_NAME = "model-selector-state";