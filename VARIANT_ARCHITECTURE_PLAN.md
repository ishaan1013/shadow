# Complete Variant-Centric Chat Architecture Implementation Plan

## Overview
Transform the chat system from task-centric to variant-centric architecture where `variantId` is the primary identifier for individual chat sessions. Each variant operates independently with its own stream state, cleanup lifecycle, and resource management.

## Phase 1: Core State Management Transformation

### 1.1 ChatService State Restructuring
**Current Issue**: All state keyed by `taskId` but should be keyed by `variantId`

```typescript
// BEFORE (task-centric):
private activeStreams: Map<string, AbortController> = new Map(); // taskId → controller
private stopRequested: Set<string> = new Set(); // taskId
private queuedActions: Map<string, QueuedAction> = new Map(); // taskId → action

// AFTER (variant-centric):  
private activeStreams: Map<string, AbortController> = new Map(); // variantId → controller
private stopRequested: Set<string> = new Set(); // variantId
private queuedActions: Map<string, QueuedAction> = new Map(); // variantId → action
```

**Impact**: 
- Each variant can stream independently without affecting others
- Queued actions are per-variant, not per-task  
- Stop requests are variant-specific

### 1.2 Method Signature Updates
**Make `variantId` required throughout the call chain:**

1. `processUserMessage`: `variantId?: string` → `variantId: string` (already done)
2. `_processUserMessageInternal`: `variantId?: string` → `variantId: string` 
3. `stopStream`: Add `variantId: string` parameter, maintain `taskId` for backwards compatibility
4. `cleanupTask`: Add variant-specific cleanup logic

## Phase 2: Stream Management Redesign

### 2.1 Independent Variant Streams
**Current Problem**: Lines 1189, 1333, 1365 call `endStream(taskId)` but function expects `endStream(variantId, taskId)`

**Solution**: 
- Update all stream operations to use `variantId` as primary key
- Pass both `variantId` and `taskId` to maintain task-level aggregation where needed
- Error handling emits to correct variant stream

### 2.2 Cleanup Architecture Decision
**Recommendation**: **Hybrid approach** - variant-specific execution, task-level coordination

```typescript
// Variant-specific cleanup (in _processUserMessageInternal)
this.activeStreams.delete(variantId);  // Clean variant stream
this.stopRequested.delete(variantId);   // Clear variant stop flag  
endStream(variantId, taskId);          // End variant stream with task context

// Task-level cleanup (remains in cleanupTask method)
stopMCPManager(taskId);                // MCP is task-scoped
updateTaskStatus(taskId, "COMPLETED"); // Overall task status
```

### 2.3 Queue Management Evolution
**Current**: Queued actions per task → **New**: Queued actions per variant

- Each variant can have its own queued message
- Multiple variants can queue independently  
- Frontend can show per-variant queue status

## Phase 3: Tool System Variant Integration

### 3.1 Tool Creation Architecture
**Current Problem**: `createTools(taskId, workspacePath)` but tools need variant context for terminal output

**Options Analyzed**:
1. **Option A**: Make tools variant-scoped - `createTools(variantId, workspacePath)`
2. **Option B**: Keep tools task-scoped but thread variantId through execution
3. **Option C**: Hybrid - tools created per-task but receive variant context at execution

**Recommendation: Option C** (least disruptive)

```typescript
// Tool creation (task-scoped, shared across variants)
const tools = await createTools(taskId, workspacePath);

// Tool execution (variant-aware)
tools.run_terminal_cmd.execute({ command: "ls" }, { variantId, taskId });
```

### 3.2 Terminal Output Routing
**Update call chain**:
1. `createAndEmitTerminalEntry(taskId, variantId, type, data, processId)`
2. `createAndEmitTerminalEntry` → `emitTerminalOutput(variantId, taskId, entry)`
3. Tool execution contexts pass `variantId` through to terminal emission

### 3.3 Tool Execution Context
**Add execution context parameter to all tool calls:**

```typescript
interface ToolExecutionContext {
  taskId: string;
  variantId: string; 
  workspacePath?: string;
}
```

## Phase 4: Filesystem & Infrastructure Updates

### 4.1 Filesystem Watchers (Already Updated)
- ✅ `LocalFileSystemWatcher` now requires `variantId`
- ✅ File change events emit with variant context
- 🔄 Need to update filesystem watcher creation in `createTools`

### 4.2 Infrastructure Resource Management
**Current**: One watcher/resources per task → **New**: One per variant

```typescript
// In createTools():
const watcher = new LocalFileSystemWatcher(taskId, variantId); // Updated constructor
activeFileSystemWatchers.set(variantId, watcher); // Key by variantId
```

## Phase 5: Error Handling & Cleanup Flows

### 5.1 Error Stream Emission (Line 1365 fix)
```typescript
// BEFORE:
handleStreamError(error, taskId);

// AFTER: 
handleStreamError(error, variantId, taskId);
```

### 5.2 Cleanup Coordination
**Task-level operations** (run once per task):
- MCP manager cleanup
- Task status updates
- Database task record updates

**Variant-level operations** (run per variant):
- Stream state cleanup  
- Terminal polling cleanup
- Filesystem watcher cleanup
- Workspace resource cleanup

### 5.3 Memory Management
**Update `MemoryCleanupService`**:
- `cleanupTaskMemory()`: Task-wide cleanup (MCP, overall status)
- `cleanupVariantMemory()`: Per-variant cleanup (streams, terminals, watchers)

## Phase 6: Database & Data Model Updates

### 6.1 Data Scoping Clarification
**Variant-scoped data**:
- ✅ **Todos**: Should be variant-scoped (correction from original assumption)
- Stream state (new architecture) 
- Terminal output and history
- File change events
- Workspace resources

**Task-scoped data**:
- Chat messages (shared history across variants)
- Task status and metadata
- MCP manager instances
- Overall task configuration

### 6.2 Todo System Migration
**Current**: Todos are task-scoped → **New**: Todos should be variant-scoped

Each variant should maintain its own independent todo list, allowing different AI models to track their own progress without interfering with each other.

## Phase 7: Backwards Compatibility & Migration

### 7.1 Validation Layer
**Add runtime checks**:
```typescript
if (!variantId) {
  throw new Error("variantId is required - legacy task-only operations not supported in multi-variant mode");
}
```

### 7.2 Database Considerations
**Chat messages** already have `taskId` (all variants share message history) ✅
**Todos** need to be migrated to variant-scoped ⚠️  
**Stream state** is now variant-scoped (new architecture) ✅

## Phase 8: Testing & Integration Points

### 8.1 Frontend Integration Points
**Frontend will need to**:
- Pass `variantId` in all socket events (already updated in interfaces)
- Handle variant-specific stream events
- Show per-variant terminal output and file changes
- Manage per-variant queue status
- Display per-variant todo lists

### 8.2 Validation Steps
1. **Compilation**: Fix all 8 remaining TypeScript errors
2. **Runtime Testing**: Verify each variant operates independently  
3. **Resource Cleanup**: Ensure proper cleanup when variants/tasks complete
4. **Multi-variant Concurrency**: Test 3 concurrent variants in one task

## Phase 9: Implementation Order

**Priority 1** (Fixes compilation errors):
1. Update ChatService state management to use `variantId` keys
2. Update `_processUserMessageInternal` signature (make `variantId` required)
3. Fix stream cleanup calls (lines 1189, 1333, 1365)
4. Fix tool creation and terminal output threading

**Priority 2** (Architectural improvements):
5. Update queue management to be variant-centric
6. Update cleanup coordination (task vs variant operations)
7. Update memory management services
8. Migrate todo system to be variant-scoped

**Priority 3** (Polish & testing):
9. Add comprehensive error handling
10. Update documentation and types
11. Integration testing

This plan establishes `variantId` as the primary identifier for chat operations while maintaining necessary task-level coordination for shared resources like MCP managers and overall task status.