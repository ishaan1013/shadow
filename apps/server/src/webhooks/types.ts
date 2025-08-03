import { z } from "zod";

// GitHub Pull Request Webhook Payload Types
export const GitHubPullRequestWebhookSchema = z.object({
  action: z.enum([
    "opened",
    "edited",
    "closed",
    "reopened",
    "synchronize",
    "ready_for_review",
    "converted_to_draft",
    "assigned",
    "unassigned",
    "review_requested",
    "review_request_removed",
    "labeled",
    "unlabeled",
    "locked",
    "unlocked"
  ]),
  number: z.number(),
  pull_request: z.object({
    id: z.number(),
    number: z.number(),
    state: z.enum(["open", "closed"]),
    merged: z.boolean(),
    title: z.string(),
    body: z.string().nullable(),
    head: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    base: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    user: z.object({
      login: z.string(),
      id: z.number(),
    }),
    merged_at: z.string().nullable(),
    closed_at: z.string().nullable(),
  }),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    private: z.boolean(),
    owner: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }),
  sender: z.object({
    login: z.string(),
    id: z.number(),
  }),
});

export type GitHubPullRequestWebhook = z.infer<typeof GitHubPullRequestWebhookSchema>;