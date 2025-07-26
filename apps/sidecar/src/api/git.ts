import { Router } from "express";
import { asyncHandler } from "./middleware";
import { GitService } from "../services/git-service";
import {
  GitCloneRequestSchema,
  GitConfigRequestSchema,
  GitBranchRequestSchema,
  GitCommitRequestSchema,
  GitPushRequestSchema,
} from "@repo/types";

export function createGitRouter(gitService: GitService): Router {
  const router = Router();

  /**
   * POST /api/git/clone
   * Clone repository to workspace
   */
  router.post(
    "/api/git/clone",
    asyncHandler(async (req, res) => {
      const { repoUrl, branch, githubToken } = GitCloneRequestSchema.parse(req.body);

      const result = await gitService.cloneRepository(repoUrl, branch, githubToken);

      if (!result.success) {
        const statusCode = result.error === "CLONE_FAILED" ? 500 : 400;
        res.status(statusCode).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /api/git/config
   * Configure git user credentials
   */
  router.post(
    "/api/git/config",
    asyncHandler(async (req, res) => {
      const { name, email } = GitConfigRequestSchema.parse(req.body);

      const result = await gitService.configureUser({ name, email });

      if (!result.success) {
        const statusCode = result.error === "CONFIG_FAILED" ? 500 : 400;
        res.status(statusCode).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /api/git/branch
   * Create and switch to shadow branch
   */
  router.post(
    "/api/git/branch",
    asyncHandler(async (req, res) => {
      const { baseBranch, shadowBranch } = GitBranchRequestSchema.parse(req.body);

      const result = await gitService.createShadowBranch(baseBranch, shadowBranch);

      if (!result.success) {
        const statusCode = result.error === "BRANCH_FAILED" ? 500 : 400;
        res.status(statusCode).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * GET /api/git/status
   * Check for uncommitted changes
   */
  router.get(
    "/api/git/status",
    asyncHandler(async (_req, res) => {
      const result = await gitService.hasChanges();

      if (!result.success) {
        const statusCode = result.error === "STATUS_FAILED" ? 500 : 400;
        res.status(statusCode).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * GET /api/git/diff
   * Get current git diff for commit message generation
   */
  router.get(
    "/api/git/diff",
    asyncHandler(async (_req, res) => {
      const result = await gitService.getDiff();

      if (!result.success) {
        const statusCode = result.error === "DIFF_FAILED" ? 500 : 400;
        res.status(statusCode).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /api/git/commit
   * Commit changes with AI-generated message and co-authoring
   */
  router.post(
    "/api/git/commit",
    asyncHandler(async (req, res) => {
      const { user, coAuthor, message } = GitCommitRequestSchema.parse(req.body);

      const result = await gitService.commitChanges({
        user,
        coAuthor,
        message,
      });

      if (!result.success) {
        const statusCode = result.error === "COMMIT_FAILED" ? 500 : 400;
        res.status(statusCode).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /api/git/push
   * Push current branch to remote repository
   */
  router.post(
    "/api/git/push",
    asyncHandler(async (req, res) => {
      const { branchName, setUpstream } = GitPushRequestSchema.parse(req.body);

      const result = await gitService.pushBranch(branchName, setUpstream);

      if (!result.success) {
        const statusCode = result.error === "PUSH_FAILED" ? 500 : 400;
        res.status(statusCode).json(result);
      } else {
        res.json(result);
      }
    })
  );

  return router;
}