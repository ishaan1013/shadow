# Automatic PR Creation Implementation Plan

## Overview

Implement automatic pull request creation at the end of LLM streaming when changes exist. The system will check for existing PRs, generate AI-powered PR metadata, and create draft/ready PRs based on task completion status.

## Architecture Analysis

### Current System Flow

1. **Streaming End**: `apps/server/src/chat.ts:658-667` - After successful completion, `commitChangesIfAny()` is called
2. **Git Operations**: `apps/server/src/services/git-manager.ts` - Handles commits, pushes to shadow branches
3. **GitHub Integration**: `apps/server/src/github/index.ts` - Has Octokit setup, token management, repo operations
4. **Task Status**: Tasks have `COMPLETED`, `STOPPED`, `FAILED`, `CANCELLED` states
5. **Shadow Branches**: Each task creates isolated shadow branch (e.g., `shadow/task-abc123`)

### Integration Points

- **Hook Point**: After `commitChangesIfAny()` in `chat.ts:660`
- **GitHub API**: Extend `GitHubService` class with PR operations
- **Token Management**: Leverage existing `githubTokenManager` for authentication
- **Error Handling**: Non-blocking - PR failures shouldn't break task completion

## Implementation Plan

### 1. Create PR Management Service (`apps/server/src/services/pr-manager.ts`)

```typescript
export interface PRMetadata {
  title: string;
  description: string;
  isDraft: boolean;
}

export interface CreatePROptions {
  taskId: string;
  repoFullName: string;
  shadowBranch: string;
  baseBranch: string;
  userId: string;
  taskTitle: string;
  taskDescription?: string;
  wasTaskCompleted: boolean; // true if COMPLETED, false if STOPPED/partial
}

export class PRManager {
  constructor(
    private githubService: GitHubService,
    private gitManager: GitManager,
  ) {}

  async createPRIfNeeded(options: CreatePROptions): Promise<void>;
  async checkExistingPR(
    repoFullName: string,
    shadowBranch: string,
    userId: string,
  ): Promise<boolean>;
  async generatePRMetadata(options: CreatePROptions): Promise<PRMetadata>;
  async createPullRequest(
    options: CreatePROptions,
    metadata: PRMetadata,
  ): Promise<string>;
}
```

### 2. Extend GitHub Service (`apps/server/src/github/index.ts`)

Add PR-related methods to existing `GitHubService` class:

```typescript
// Add to GitHubService class:
async listPullRequests(repoFullName: string, head: string, userId: string): Promise<any[]>
async createPullRequest(
  repoFullName: string,
  options: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
  },
  userId: string
): Promise<{ url: string; number: number }>
```

### 3. LLM Integration for PR Metadata Generation

Create new LLM service method for PR content generation:

```typescript
// In apps/server/src/llm.ts or new service
async generatePRMetadata(options: {
  taskTitle: string;
  taskDescription?: string;
  gitDiff: string;
  commitMessages: string[];
  wasTaskCompleted: boolean;
}): Promise<{
  title: string;
  description: string;
  isDraft: boolean;
}>
```

**LLM Prompt Strategy:**

- **Title**: Concise, action-oriented (50 chars max)
- **Description**: Bullet points covering:
  - What was implemented/changed
  - Key files modified
  - Testing notes (if applicable)
  - Known limitations (if partial completion)
- **Draft Status**:
  - `false` (ready) if task completed successfully
  - `true` (draft) if task was stopped/partial/has issues

### 4. Integration Hook in Chat Service

Modify `apps/server/src/chat.ts` processUserMessage method:

```typescript
// After line 667 (after commitChangesIfAny)
if (!wasStoppedEarly) {
  // Try to create PR if changes were committed
  try {
    await this.createPRIfNeeded(taskId, workspacePath, task);
  } catch (error) {
    console.error(`[CHAT] Failed to create PR for task ${taskId}:`, error);
    // Non-blocking - don't fail the entire response
  }
}

private async createPRIfNeeded(taskId: string, workspacePath: string, task: Task): Promise<void> {
  const prManager = new PRManager(this.githubService, new GitManager(workspacePath));

  await prManager.createPRIfNeeded({
    taskId,
    repoFullName: task.repoFullName,
    shadowBranch: task.shadowBranch,
    baseBranch: task.baseBranch,
    userId: task.userId,
    taskTitle: task.title,
    taskDescription: task.description,
    wasTaskCompleted: task.status === 'COMPLETED'
  });
}
```

### 5. Error Handling & Logging

- **Non-blocking**: PR creation failures shouldn't affect task completion
- **Detailed logging**: Track PR creation attempts, failures, successes
- **Graceful degradation**: Continue without PR if GitHub API unavailable
- **Rate limiting**: Handle GitHub API rate limits appropriately

### 6. Configuration & Feature Flags

Add environment variables:

```bash
# Enable/disable auto PR creation
AUTO_CREATE_PRS=true

# PR settings
PR_DEFAULT_DRAFT=false
PR_BODY_MAX_LENGTH=65536
```

### 7. Database Schema Updates (Optional)

Consider adding PR tracking to Task model:

```prisma
model Task {
  // ... existing fields
  pullRequestUrl    String?
  pullRequestNumber Int?
  pullRequestCreated Boolean @default(false)
}
```

## Implementation Steps

### Phase 1: Core Infrastructure

1. **Create PR Manager Service** - Handle PR existence checks, creation logic
2. **Extend GitHub Service** - Add Octokit PR operations
3. **LLM PR Generation** - Implement AI-powered title/description generation

### Phase 2: Integration

4. **Hook into Chat Service** - Add PR creation after commit
5. **Error Handling** - Implement robust error handling and logging
6. **Testing** - Unit tests for PR logic, integration tests

### Phase 3: Enhancements

7. **Configuration** - Environment variables, feature flags
8. **Database Tracking** - Optional PR URL/number storage
9. **WebSocket Events** - Real-time PR creation notifications to frontend

## Technical Considerations

### GitHub API Integration

- **Authentication**: Leverage existing `githubTokenManager`
- **Permissions**: Requires `pull_requests:write` scope
- **Rate Limits**: GitHub allows 5000 requests/hour for authenticated users
- **Error Cases**: Handle repo permissions, branch protection rules

### LLM Generation Strategy

- **Model Selection**: Use GPT-4o-mini for cost efficiency
- **Context Window**: Include git diff, commit messages, task context
- **Prompt Engineering**: Optimize for concise, informative PR descriptions
- **Fallback Content**: Default templates if LLM generation fails

### Performance Impact

- **Async Operation**: PR creation runs asynchronously after commit
- **Timeout Handling**: Set reasonable timeouts for GitHub API calls
- **Memory Usage**: Clean up resources after PR creation
- **Caching**: Cache PR existence checks to avoid duplicate API calls

### Edge Cases

- **Branch Protection**: Handle cases where PRs can't be created
- **Duplicate PRs**: Robust checking to prevent duplicate PR creation
- **Partial Commits**: Handle cases where commits exist but task incomplete
- **Network Failures**: Retry logic for transient GitHub API failures

## Success Metrics

- **PR Creation Rate**: % of completed tasks that get PRs created
- **Error Rate**: % of PR creation attempts that fail
- **User Adoption**: Usage of auto-created PRs vs manual creation
- **Performance Impact**: Latency added to task completion

## Future Enhancements

- **PR Templates**: Repository-specific PR templates
- **Auto-reviewers**: Automatically request reviews from team members
- **Labels/Assignees**: Auto-apply labels based on task type/content
- **Integration**: Link PRs back to Shadow task interface
- **Analytics**: Track PR creation success rates, common failure modes
