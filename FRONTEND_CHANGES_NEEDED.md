# Frontend Changes Required for Multi-Variant Support

This document outlines the frontend changes needed to fully support the multi-variant task architecture. The backend has been updated to support variant-specific operations, but the frontend needs to be updated to pass the correct parameters.

## 🔄 Immediate Changes Required

### 1. File Operations - Add variantId Query Parameter

**Files to update**: Components that make file API requests

**Changes needed**:
```typescript
// Before (old API)
const response = await fetch(`/api/tasks/${taskId}/files/tree`);

// After (new variant-aware API)
const response = await fetch(`/api/tasks/${taskId}/files/tree?variantId=${currentVariantId}`);
```

**API endpoints affected**:
- `GET /api/tasks/:taskId/files/tree?variantId=xyz`
- `GET /api/tasks/:taskId/files/content?variantId=xyz&path=...`  
- `GET /api/tasks/:taskId/file-changes?variantId=xyz`

**Backward compatibility**: If no `variantId` is provided, backend falls back to first variant, so this is non-breaking.

**Implementation strategy**:
1. Add `currentVariantId` to file operation components' state/props
2. Append `?variantId=${currentVariantId}` to file API calls
3. For multi-variant tasks, use the currently active/selected variant ID
4. For single-variant tasks, use the single variant ID

### 2. PR Creation - Pass variantId in Options

**Files to update**: Components that trigger PR creation

**Changes needed**:
```typescript
// Before (old PR creation)
const prOptions = {
  taskId,
  repoFullName,
  shadowBranch,
  baseBranch,
  userId,
  taskTitle,
  wasTaskCompleted,
  messageId
};

// After (variant-aware PR creation)
const prOptions = {
  taskId,
  variantId: currentVariantId, // ADD THIS
  repoFullName,
  shadowBranch,
  baseBranch, 
  userId,
  taskTitle,
  wasTaskCompleted,
  messageId
};
```

**Why needed**: Each variant can now have its own pull request. The backend needs to know which variant is creating the PR.

**Implementation notes**:
- PR status events are now variant-specific
- Multiple variants can create separate PRs for the same task
- PR tracking is now per-variant, not per-task

### 3. Variant Context Management

**New requirement**: Frontend needs to track which variant is currently active/selected

**Suggested implementation**:
```typescript
interface VariantContext {
  taskId: string;
  currentVariantId: string;
  availableVariants: Array<{
    id: string;
    model: ModelType;
    status: VariantStatus;
  }>;
}

// Context provider for variant-aware components
const VariantContextProvider = ({ children, taskId }) => {
  const [currentVariantId, setCurrentVariantId] = useState<string>();
  // ... context logic
};
```

## 📋 Implementation Checklist

### Phase 1: File Operations (High Priority)
- [ ] Identify all components making file API calls
- [ ] Add variantId parameter to file tree requests
- [ ] Add variantId parameter to file content requests  
- [ ] Add variantId parameter to file changes requests
- [ ] Update file operation hooks/utilities
- [ ] Test file operations with variant context

### Phase 2: PR Integration (High Priority)  
- [ ] Identify PR creation trigger points
- [ ] Update PR creation options to include variantId
- [ ] Update PR status event handlers for variant-specific events
- [ ] Test PR creation flow with multiple variants

### Phase 3: Variant Context (Medium Priority)
- [ ] Create VariantContext provider
- [ ] Add variant selection UI (if not already present)
- [ ] Update components to consume variant context
- [ ] Add variant switching functionality
- [ ] Handle variant-specific state management

### Phase 4: WebSocket Events (Medium Priority)
- [ ] Update WebSocket handlers for variant-specific events
- [ ] Ensure task status updates are properly scoped
- [ ] Handle variant-specific progress events
- [ ] Test real-time updates with multiple variants

## ✅ Backend Alignment (as of current merge)

- WebSockets now require `variantId` for these events:
  - `user-message`, `get-chat-history`, `stop-stream`, `get-terminal-history`, `clear-terminal`, `create-stacked-pr`, `clear-queued-action` (now `{ taskId, variantId }`).
- HTTP messages route is variant-first:
  - `GET /api/tasks/:taskId/:variantId/messages` (no task-only fallback).
- Tools and terminal output are variant-scoped:
  - `createTools(taskId, variantId, workspacePath?)`; in local mode if `workspacePath` is omitted, backend derives `<workspaceDir>/tasks/<variantId>`.
  - Terminal output and filesystem watcher are keyed by `variantId`.
- Chat history and todos are variant-scoped:
  - `getChatHistory(taskId, variantId)`; `todo_write` filters `{ taskId, variantId }`.

### FE TODOs tied to these changes
- Ensure all socket emits include `variantId`.
- Update any REST calls for messages to the new route with `:variantId`.
- When showing terminal/history/todo panels, scope by `currentVariantId`.

## 🔍 How to Find Components to Update

### File Operation Components
Search for these patterns in the codebase:
```bash
# Find file API calls
grep -r "files/tree" apps/frontend/
grep -r "files/content" apps/frontend/
grep -r "file-changes" apps/frontend/

# Find file operation hooks
find apps/frontend/ -name "*.ts*" -exec grep -l "useFile\|file.*hook\|FileTree" {} \;
```

### PR Creation Components  
Search for these patterns:
```bash
# Find PR creation calls
grep -r "createPR\|pull.*request\|auto-pr" apps/frontend/
grep -r "CreatePROptions\|PRManager" apps/frontend/
```

### Variant-Related Components
```bash
# Find variant/model selection components  
grep -r "variant\|ModelSelect\|model.*select" apps/frontend/
grep -r "VariantStatus\|variant.*status" apps/frontend/
```

## 🎯 Expected Timeline

- **Phase 1 (File Operations)**: 2-3 hours
- **Phase 2 (PR Integration)**: 1-2 hours  
- **Phase 3 (Variant Context)**: 3-4 hours
- **Phase 4 (WebSocket Events)**: 2-3 hours
- **Testing & Refinement**: 2-3 hours

**Total Estimated**: 10-15 hours for complete frontend integration

## ⚠️ Important Notes

1. **Non-breaking changes**: All backend changes include fallbacks, so existing frontend will continue to work
2. **Gradual migration**: Can implement changes incrementally without breaking existing functionality
3. **Testing strategy**: Test with both single-variant and multi-variant tasks
4. **Error handling**: Add proper error handling for missing variant context
5. **Performance**: Consider caching variant information to avoid repeated API calls

## 🤝 Backend Support Available

The backend team has implemented:
- ✅ Backward-compatible API endpoints
- ✅ Proper error handling for missing variantId
- ✅ Variant-aware WebSocket events  
- ✅ Multi-variant task cleanup logic
- ✅ Variant-based PR creation and tracking

Ready to support frontend integration testing and debugging.