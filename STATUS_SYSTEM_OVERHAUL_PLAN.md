# Status System Overhaul Plan

**⚠️ IMPORTANT**: This document provides a high-level implementation plan but is **NOT 100% complete** in terms of all files that need to be changed. Before implementing, you MUST:
1. **Comprehensively understand the codebase** - trace through all imports, references, and dependencies
2. **Search for all usages** of `InitStepType`, `lastCompletedStep`, `TaskStatus` enum values, etc.
3. **Identify additional files** that may need updates beyond those listed here
4. **Test thoroughly** in both local and remote modes
5. **Consider edge cases** and error handling scenarios

This plan is a starting point - use it as guidance but do your own comprehensive analysis.

---

## **Overview**

Replace the current mixed status system with a cleaner two-enum approach:
- **TaskStatus**: User-facing task progress (`INITIALIZING → RUNNING → COMPLETED → ARCHIVED`)
- **InitStatus**: Infrastructure state (`INACTIVE → [steps] → ACTIVE`)

Add background cleanup system for remote mode with 10-minute delay for better follow-up UX.

---

## **Phase 1: Database Schema Updates**

### **1.1 Update Enums in schema.prisma (UPPERCASE)**
```sql
enum TaskStatus {
  INITIALIZING
  RUNNING  
  STOPPED
  COMPLETED    // instead of ready_for_review
  FAILED
  ARCHIVED
}

enum InitStatus {
  INACTIVE
  PREPARE_WORKSPACE
  CREATE_VM
  WAIT_VM_READY
  VERIFY_VM_WORKSPACE
  INDEX_REPOSITORY
  ACTIVE
}
```

### **1.2 Update Task model**
- Replace `lastCompletedStep InitStepType?` with `initStatus InitStatus @default(INACTIVE)`
- Add `scheduledCleanupAt DateTime?` for cleanup timing
- Keep existing fields intact

### **1.3 Database push (no migration)**
- `npx prisma db push` to apply schema changes
- Existing data will be handled by default values

---

## **Phase 2: Types Package Updates**

### **2.1 Update `/packages/types/src/chat/streaming.ts`**
- Change `InitializationProgress.currentStep?: InitStepType` to `InitStatus`
- Change `InitializationProgress.lastCompletedStep?: InitStepType` to `InitStatus`
- Import `InitStatus` from `@repo/db` instead of `InitStepType`

### **2.2 Update `/packages/types/src/init/steps.ts`**
- Change `STEP_DISPLAY_NAMES: Record<InitStepType, string>` to `Record<InitStatus, string>`
- Update `getStepsForMode()` return type to `InitStatus[]`
- Add display names for `INACTIVE` and `ACTIVE` states

### **2.3 Update `/packages/types/src/tasks/status.ts`**
- Replace all `InitStepType` references with `InitStatus`
- Update helper functions to work with new enum

### **2.4 Update `/packages/types/src/ui/events.ts`**
- Update `TaskStatusUpdateEvent` to include `initStatus: InitStatus`

---

## **Phase 3: Backend Core Changes**

### **3.1 TaskInitializationEngine (`/apps/server/src/initialization/index.ts`)**
- Replace `InitStepType` imports with `InitStatus`
- Update `STEP_DEFINITIONS` to use `InitStatus` enum
- Change `setTaskInProgress(taskId, step)` to `setInitStatus(taskId, step)`
- Update all step progression logic to use `InitStatus`
- Set `initStatus: ACTIVE` when initialization completes

### **3.2 Task status utilities (`/apps/server/src/utils/task-status.ts`)**
- Replace `lastCompletedStep` field updates with `initStatus`
- Add `scheduleTaskCleanup(taskId, delayMinutes)` function
- Add `cancelTaskCleanup(taskId)` function
- Update completion handler: Set `taskStatus: COMPLETED` + schedule cleanup

### **3.3 Follow-up message handler**
- Check if task has `scheduledCleanupAt`
- If yes: Clear `scheduledCleanupAt`, set `taskStatus: RUNNING`
- If `initStatus: INACTIVE`: Run re-initialization (set `taskStatus: INITIALIZING`)

---

## **Phase 4: Background Cleanup Service (Remote Mode Only)**

### **4.1 New file `/apps/server/src/services/task-cleanup.ts`**
```typescript
import { prisma } from "@repo/db";
import { getAgentMode } from "../execution";

class TaskCleanupService {
  private interval: NodeJS.Timeout | null = null;
  
  start() {
    // Only run cleanup in remote mode
    if (getAgentMode() !== "firecracker") return;
    
    this.interval = setInterval(async () => {
      await this.processCleanupQueue();
    }, 60 * 1000); // Every minute
  }
  
  private async processCleanupQueue() {
    const tasksToCleanup = await prisma.task.findMany({
      where: {
        scheduledCleanupAt: { lte: new Date() },
        NOT: { scheduledCleanupAt: null }
      }
    });
    
    for (const task of tasksToCleanup) {
      await this.cleanupTask(task.id);
    }
  }
  
  private async cleanupTask(taskId: string) {
    // 1. Cleanup workspace/pod via workspace manager
    // 2. Update: taskStatus: ARCHIVED, scheduledCleanupAt: null, initStatus: INACTIVE
  }
}
```

### **4.2 Service integration in `/apps/server/src/app.ts`**
- Import and start TaskCleanupService
- Graceful shutdown handling

---

## **Phase 5: WebSocket Event Updates**

### **5.1 Update socket events (`/apps/server/src/socket.ts`)**
- Update `TaskStatusUpdateEvent` emission to include `initStatus`
- Ensure frontend receives both status fields

### **5.2 Progress emissions**
- Update initialization progress to use `InitStatus` enum
- Handle `INACTIVE` and `ACTIVE` states in progress tracking

---

## **Phase 6: Execution Layer Updates**

### **6.1 Update workspace managers**
- Replace `InitStepType` references with `InitStatus`
- Update cleanup logic to work with new timer system

### **6.2 Update execution factory (`/apps/server/src/execution/index.ts`)**
- Ensure all agent mode detection works with cleanup logic

---

## **Phase 7: Frontend Updates**

### **7.1 Status display**
- Handle `COMPLETED` status in UI (show "Ready for follow-up")
- Update initialization progress to use `InitStatus`
- Handle `INACTIVE` state for re-initialization display

---

## **Implementation Order**
1. Database schema update (db push)
2. Types package updates
3. Backend status utilities and initialization engine
4. Background cleanup service
5. WebSocket/execution layer updates
6. Frontend status handling
7. Testing in both local and remote modes

---

## **Key Files to Modify (Incomplete List - Search for More!)**
- `packages/db/prisma/schema.prisma`
- `packages/types/src/chat/streaming.ts`
- `packages/types/src/init/steps.ts`
- `packages/types/src/tasks/status.ts`
- `packages/types/src/ui/events.ts`
- `apps/server/src/initialization/index.ts`
- `apps/server/src/utils/task-status.ts`
- `apps/server/src/services/task-cleanup.ts` (new)
- `apps/server/src/socket.ts`
- Frontend status components
- **⚠️ Search comprehensively for**: `InitStepType`, `lastCompletedStep`, `COMPLETED`, `INITIALIZING`, etc.

---

## **Remote Mode Only Cleanup**
- Cleanup service only runs when `agentMode === "firecracker"`
- Local mode tasks complete immediately without cleanup delays

---

## **Task Lifecycle Flow**

### **New Task Creation**
```
taskStatus: INITIALIZING
initStatus: INACTIVE
```

### **During Initialization**
```
taskStatus: INITIALIZING
initStatus: PREPARE_WORKSPACE → CREATE_VM → WAIT_VM_READY → VERIFY_VM_WORKSPACE → INDEX_REPOSITORY
```

### **Ready for Work**
```
taskStatus: RUNNING
initStatus: ACTIVE
```

### **Task Completion (Remote Mode)**
```
taskStatus: COMPLETED
scheduledCleanupAt: NOW() + 10 minutes
```

### **Follow-up Within 10 Minutes**
```
taskStatus: RUNNING (cancel cleanup timer)
initStatus: ACTIVE (stays active)
```

### **Follow-up After Cleanup**
```
taskStatus: INITIALIZING (re-init required)
initStatus: INACTIVE → [steps] → ACTIVE
```

### **Final Cleanup**
```
taskStatus: ARCHIVED
initStatus: INACTIVE
scheduledCleanupAt: null
```

---

## **Benefits**
- ✅ **Cleaner separation**: Task progress vs infrastructure state
- ✅ **Better UX**: 10-minute window for instant follow-ups
- ✅ **Remote mode optimization**: Delayed cleanup only where needed
- ✅ **Robust cleanup**: Database-first approach survives restarts
- ✅ **Maintainable**: Clear enum values and state transitions