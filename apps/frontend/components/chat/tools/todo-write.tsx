import type { Message } from "@repo/types";
import { CheckCircle, Circle, Clock, X } from "lucide-react";
import { CollapsibleTool } from "./collapsible-tool";

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

function StatusIcon({ status }: { status: TodoItem["status"] }) {
  switch (status) {
    case "pending":
      return <Circle className="size-4 text-gray-400" />;
    case "in_progress":
      return <Clock className="size-4 text-blue-500" />;
    case "completed":
      return <CheckCircle className="size-4 text-green-500" />;
    case "cancelled":
      return <X className="size-4 text-red-500" />;
  }
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  const statusCounts = todos.reduce(
    (acc, todo) => {
      acc[todo.status] = (acc[todo.status] || 0) + 1;
      return acc;
    },
    {} as Record<TodoItem["status"], number>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {statusCounts.pending && (
          <span className="flex items-center gap-1">
            <Circle className="size-3" />
            {statusCounts.pending} pending
          </span>
        )}
        {statusCounts.in_progress && (
          <span className="flex items-center gap-1">
            <Clock className="size-3 text-blue-500" />
            {statusCounts.in_progress} in progress
          </span>
        )}
        {statusCounts.completed && (
          <span className="flex items-center gap-1">
            <CheckCircle className="size-3 text-green-500" />
            {statusCounts.completed} completed
          </span>
        )}
        {statusCounts.cancelled && (
          <span className="flex items-center gap-1">
            <X className="size-3 text-red-500" />
            {statusCounts.cancelled} cancelled
          </span>
        )}
      </div>

      <div className="space-y-2">
        {todos.map((todo, index) => (
          <div key={todo.id} className="flex items-start gap-2">
            <StatusIcon status={todo.status} />
            <div className="flex-1 min-w-0">
              <div className="text-sm">
                <span
                  className={`${
                    todo.status === "completed"
                      ? "line-through text-muted-foreground"
                      : todo.status === "cancelled"
                        ? "line-through text-red-500/70"
                        : ""
                  }`}
                >
                  {todo.content}
                </span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {index + 1}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TodoWriteTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const merge = args.merge as boolean;
  const todos = args.todos as TodoItem[];

  let parsedResult;
  try {
    parsedResult = typeof result === "string" ? JSON.parse(result) : result;
  } catch {
    parsedResult = null;
  }

  const title = `${merge ? "Merge" : "Replace"} todos (${todos.length} items)`;

  return (
    <CollapsibleTool
      icon={<CheckCircle />}
      title={title}
      className="todo-tool"
    >
      {status === "COMPLETED" && parsedResult?.success && (
        <div className="text-xs text-green-600 dark:text-green-400 mb-2">
          {parsedResult.message}
        </div>
      )}

      {status === "FAILED" && (
        <div className="text-xs text-red-600 dark:text-red-400 mb-2">
          {parsedResult?.error || "Failed to manage todos"}
        </div>
      )}

      <TodoList todos={todos} />
    </CollapsibleTool>
  );
}