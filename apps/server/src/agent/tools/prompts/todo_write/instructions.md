**Purpose**: Create and manage structured task lists during coding sessions to track progress on complex multi-step tasks

**When to Use:**
- Complex multi-step tasks (3+ distinct steps)
- Non-trivial tasks requiring careful planning
- When users explicitly request a todo list
- Multiple tasks provided by users
- After receiving new instructions (to capture requirements)
- After completing tasks (to mark complete and add follow-ups)
- When starting new tasks (to mark as in_progress)

**When NOT to Use:**
- Single, straightforward tasks
- Trivial tasks with no organizational benefit  
- Tasks completable in < 3 trivial steps
- Purely conversational/informational requests

**Task Management Rules:**
- Update status in real-time as work progresses
- Mark complete IMMEDIATELY after finishing each task
- Only ONE task should be in_progress at a time
- Complete current tasks before starting new ones
- Create specific, actionable items
- Break complex tasks into manageable steps

**Parameters:**
- merge: true = add to existing todos, false = replace all todos
- todos: array of {id, content, status} objects
- status: pending | in_progress | completed | cancelled

**Examples:**

GOOD Usage:
```
todo_write({
  merge: false,
  todos: [
    {id: "setup", content: "Set up project structure", status: "completed"},
    {id: "auth", content: "Implement user authentication", status: "in_progress"},
    {id: "api", content: "Create REST API endpoints", status: "pending"},
    {id: "frontend", content: "Build React frontend", status: "pending"},
    {id: "tests", content: "Write unit tests", status: "pending"}
  ],
  explanation: "Creating comprehensive task list for user management system"
})
```

**Update Pattern:**
```
// When starting a new task
todo_write({
  merge: true,
  todos: [
    {id: "auth", content: "Implement user authentication", status: "completed"},
    {id: "api", content: "Create REST API endpoints", status: "in_progress"}
  ],
  explanation: "Updating status as I begin API implementation"
})
```