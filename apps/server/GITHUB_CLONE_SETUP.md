# GitHub Repository Cloning Feature

This document describes the GitHub repository cloning functionality that automatically clones selected repositories for each task.

## Overview

When users create a new task through the frontend, they can select a GitHub repository and branch. The system will automatically clone that repository to an isolated workspace directory before starting the coding agent.

## Architecture

### Frontend Flow
1. User selects repository and branch using `GithubConnection` component
2. `PromptForm` passes `repoUrl` and `branch` to task creation
3. `create-task.ts` server action creates task with repository information
4. Task initiation API automatically handles cloning

### Backend Components

#### GitHubCloneService (`apps/server/src/services/github-clone.ts`)
- Handles repository cloning using Octokit and git commands
- Provides isolated workspace directories per task
- Supports clone progress tracking
- Includes comprehensive error handling

Key methods:
- `cloneRepository()` - Main cloning function with progress callbacks
- `verifyRepoAccess()` - Checks if user has access to repository
- `verifyBranchExists()` - Validates branch exists
- `getClonedRepoPath()` - Returns path to cloned repository
- `cleanupTaskWorkspace()` - Cleanup function for completed tasks

#### Workspace Isolation
- Each task gets isolated directory: `${WORKSPACE_DIR}/task-${taskId}/`
- Cloned repos are placed in: `${WORKSPACE_DIR}/task-${taskId}/${repoName}/`
- All tools operate within the task-specific workspace
- Prevents conflicts between concurrent tasks

#### Tool System Updates
All coding tools now support workspace directory context:
- `read_file` - Reads files from task workspace
- `edit_file` - Creates/modifies files in task workspace
- `run_terminal_cmd` - Executes commands in task workspace
- `list_dir` - Lists directories in task workspace
- `grep_search` - Searches within task workspace
- `file_search` - Finds files in task workspace
- `delete_file` - Deletes files from task workspace

### Database Changes

#### Task Status
Added `INITIALIZING` status to `TaskStatus` enum:
```prisma
enum TaskStatus {
  PENDING
  INITIALIZING  // New: Repository is being cloned
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}
```

#### Task Fields
Existing fields used for repository information:
- `repoUrl` - GitHub repository URL or `owner/repo` format
- `branch` - Target branch name (defaults to "main")

### Real-time Progress

#### WebSocket Events
- `clone-progress` - Emitted during cloning process
  ```typescript
  {
    taskId: string;
    status: "cloning" | "completed" | "error";
    message: string;
    progress?: number; // 0-100
  }
  ```

#### Frontend Integration
- Clone progress indicator in task page
- Real-time progress bar during cloning
- Success/error notifications

## Configuration

### Environment Variables
- `WORKSPACE_DIR` - Base directory for all task workspaces (default: `/workspace`)
- `GITHUB_CLIENT_ID` - GitHub OAuth app client ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth app secret

### Requirements
- Git must be installed and available in PATH
- GitHub OAuth authentication configured
- User must have access to target repository

## API Endpoints

### Task Initiation
`POST /api/tasks/:taskId/initiate`

Enhanced to handle repository cloning:
1. Checks if task has `repoUrl`
2. Updates task status to `INITIALIZING`
3. Retrieves user's GitHub access token
4. Clones repository to task workspace
5. Updates task status to `RUNNING`
6. Starts LLM processing

### Test Endpoint
`POST /api/test-clone` (development only)

Test repository cloning functionality:
```json
{
  "repoUrl": "owner/repo",
  "branch": "main",
  "accessToken": "github_token"
}
```

## Usage Examples

### Creating Task with Repository
```typescript
// Frontend task creation
const formData = new FormData();
formData.append("message", "Fix the authentication bug");
formData.append("model", "gpt-4o");
formData.append("repoUrl", "myorg/myapp");
formData.append("branch", "develop");

const taskId = await createTask(formData);
```

### Tool Usage in Cloned Repository
```typescript
// Tools automatically work in cloned repo context
await tools.read_file({
  target_file: "src/auth.ts",  // Reads from cloned repo
  should_read_entire_file: true,
  explanation: "Reading authentication module"
});
```

## Error Handling

### Common Errors
- **Repository not found**: User lacks access or repo doesn't exist
- **Branch not found**: Specified branch doesn't exist
- **Git not available**: Git is not installed on system
- **Authentication failed**: GitHub token is invalid or expired
- **Clone timeout**: Repository is too large or network issues

### Error Recovery
- Task status set to `FAILED` on clone errors
- Detailed error messages provided to frontend
- Automatic cleanup of partial clones
- Graceful fallback to default workspace for local tasks

## Testing

### Unit Tests
```bash
# Test clone service functionality
npm run test-clone
```

### Manual Testing
1. Create task with public repository
2. Verify clone progress indicators
3. Check tools work in cloned repository
4. Test error scenarios (invalid repo, branch)

## Security Considerations

- GitHub access tokens stored securely in database
- Workspace directories isolated per task
- No exposure of clone URLs in logs
- Automatic cleanup of sensitive data
- Repository access validated before cloning

## Performance

### Optimizations
- Shallow clone (`--depth 1`) for faster cloning
- Single branch checkout (`--single-branch`)
- Parallel verification of repo and branch access
- Efficient workspace directory reuse

### Monitoring
- Clone progress tracking
- Performance metrics in logs
- Error rate monitoring
- Workspace disk usage tracking