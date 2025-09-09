import { customAlphabet } from "nanoid";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateTaskId() {
  const nanoId = customAlphabet(ALPHABET, 12);
  const taskId = nanoId();
  return taskId;
}

export function generateVariantId() {
  const nanoId = customAlphabet(ALPHABET, 12);
  const variantId = nanoId();
  return variantId;
}

export function generateShadowBranch(taskId: string, sequence: number): string {
  return `shadow/task-${taskId}/variant-${sequence}`;
}
