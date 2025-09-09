import crypto from "crypto";
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { updateVariantStatus } from "../utils/variant-status";
import config from "../config";
import {
  GitHubPullRequestWebhookSchema,
  GitHubPullRequestWebhook,
} from "./types";

/**
 * Verify GitHub webhook signature
 */
function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  const receivedSignature = signature.slice(7); // Remove 'sha256=' prefix

  // Check if lengths match before timing-safe comparison
  if (expectedSignature.length !== receivedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, "hex"),
    Buffer.from(receivedSignature, "hex")
  );
}

/**
 * Process pull request closed event (merged or closed)
 */
async function processPullRequestClosed(
  payload: GitHubPullRequestWebhook,
  repoFullName: string,
  prNumber: number
): Promise<number> {
  const isMerged = payload.pull_request.merged;
  const action = isMerged ? "merged" : "closed";

  // Find all variants associated with this PR
  const variants = await prisma.variant.findMany({
    where: {
      pullRequestNumber: prNumber,
      task: {
        repoFullName: repoFullName,
      },
      status: { not: "STOPPED" },
    },
    select: { id: true, taskId: true },
  });

  if (variants.length === 0) {
    console.log(`[WEBHOOK] No active variants found for PR #${prNumber}`);
    return 0;
  }

  // Update all found variants to STOPPED status
  await Promise.all(
    variants.map((variant) => updateVariantStatus(variant.id, "STOPPED", "WEBHOOK"))
  );

  console.log(
    `[WEBHOOK] Archived ${variants.length} variants for PR #${prNumber} (${action})`
  );
  return variants.length;
}

/**
 * Main GitHub webhook handler
 */
export async function handleGitHubWebhook(req: Request, res: Response) {
  try {
    const webhookSecret = config.githubWebhookSecret;
    if (!webhookSecret) {
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    // Get signature from headers
    const signature = req.headers["x-hub-signature-256"] as string;
    if (!signature) {
      return res.status(400).json({ error: "Missing signature header" });
    }

    // Get raw body for signature verification
    const rawBody = req.body.toString("utf8");

    // Verify webhook signature
    if (!verifyGitHubSignature(rawBody, signature, webhookSecret)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    // Parse and validate payload
    const parsedBody = JSON.parse(rawBody);
    const validation = GitHubPullRequestWebhookSchema.safeParse(parsedBody);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const payload = validation.data;
    const { action, pull_request, repository } = payload;

    // Only process closed PRs
    if (action !== "closed") {
      return res.status(200).json({ message: "Ignored" });
    }

    const tasksArchived = await processPullRequestClosed(
      payload,
      repository.full_name,
      pull_request.number
    );

    res.status(200).json({
      message: "Success",
      tasksArchived,
    });
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
