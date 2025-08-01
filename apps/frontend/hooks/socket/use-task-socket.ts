"use client";

import { useSocket } from "./use-socket";
import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AssistantMessagePart,
  Message,
  StreamChunk,
  TaskStatusUpdateEvent,
  ModelType,
  FileNode,
} from "@repo/types";
import { TextPart, ToolCallPart, ToolResultPart } from "ai";
import type { TaskWithDetails } from "@/lib/db-operations/get-task-with-details";
import { TaskMessages } from "@/lib/db-operations/get-task-messages";
import { getMostRecentMessageModel } from "@/lib/utils/model-utils";
import { CodebaseTreeResponse } from "../use-codebase-tree";
import { Task, TodoStatus } from "@repo/db";

interface FileChange {
  filePath: string;
  operation: "CREATE" | "UPDATE" | "DELETE" | "RENAME";
  additions: number;
  deletions: number;
  createdAt: string;
}

interface FsChangeEvent {
  operation:
    | "file-created"
    | "file-modified"
    | "file-deleted"
    | "directory-created"
    | "directory-deleted";
  filePath: string;
  timestamp: number;
  source: "local" | "remote";
  isDirectory: boolean;
}

/**
 * Optimistically update codebase tree based on filesystem events
 */
function updateCodebaseTreeOptimistically(
  existingTree: FileNode[],
  fsChange: FsChangeEvent
): FileNode[] {
  const { operation, filePath, isDirectory } = fsChange;

  console.log(
    `[OPTIMISTIC_TREE_UPDATE] ${operation} ${filePath} (isDirectory: ${isDirectory})`
  );

  if (operation === "file-created" || operation === "directory-created") {
    return addNodeToTree(
      existingTree,
      filePath,
      isDirectory ? "folder" : "file"
    );
  }

  if (operation === "file-deleted" || operation === "directory-deleted") {
    return removeNodeFromTree(existingTree, filePath);
  }

  return existingTree;
}

/**
 * Add a new node to the file tree
 */
function addNodeToTree(
  tree: FileNode[],
  filePath: string,
  type: "file" | "folder"
): FileNode[] {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 0) return tree;

  const [firstPart, ...restParts] = parts;
  if (!firstPart) return tree;

  const treeCopy = [...tree];

  const existingIndex = treeCopy.findIndex((node) => node.name === firstPart);

  if (restParts.length === 0) {
    if (existingIndex === -1) {
      const newNode = {
        name: firstPart,
        type,
        path: `/${filePath}`,
        ...(type === "folder" && { children: [] }),
      };
      treeCopy.push(newNode);

      // Sort: folders first, then files, both alphabetically
      treeCopy.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }
    return treeCopy;
  }

  if (existingIndex === -1) {
    // Create intermediate folder
    const newFolder = {
      name: firstPart,
      type: "folder" as const,
      path: `/${parts.slice(0, 1).join("/")}`,
      children: [],
    };
    treeCopy.push(newFolder);
  }

  // Ensure the node at this level is a folder with children
  const nodeIndex = treeCopy.findIndex((node) => node.name === firstPart);
  if (nodeIndex !== -1 && treeCopy[nodeIndex]?.type === "folder") {
    if (!treeCopy[nodeIndex].children) {
      treeCopy[nodeIndex].children = [];
    }
    // Recursively add to children
    treeCopy[nodeIndex].children = addNodeToTree(
      treeCopy[nodeIndex].children || [],
      restParts.join("/"),
      type
    );
  }

  return treeCopy;
}

/**
 * Remove a node from the file tree
 */
function removeNodeFromTree(tree: FileNode[], filePath: string): FileNode[] {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 0) return tree;

  const [firstPart, ...restParts] = parts;
  if (!firstPart) return tree;

  const treeCopy = [...tree];

  if (restParts.length === 0) {
    // Remove the target node
    return treeCopy.filter((node) => node.name !== firstPart);
  }

  // Recursively remove from children
  const nodeIndex = treeCopy.findIndex((node) => node.name === firstPart);
  if (
    nodeIndex !== -1 &&
    treeCopy[nodeIndex]?.type === "folder" &&
    treeCopy[nodeIndex]?.children
  ) {
    treeCopy[nodeIndex].children = removeNodeFromTree(
      treeCopy[nodeIndex].children || [],
      restParts.join("/")
    );
    // Remove empty folders
    if (treeCopy[nodeIndex].children?.length === 0) {
      return treeCopy.filter((_, index) => index !== nodeIndex);
    }
  }

  return treeCopy;
}

/**
 * Optimistically update file changes array based on filesystem events
 */
function updateFileChangesOptimistically(
  existingChanges: FileChange[],
  fsChange: FsChangeEvent
): FileChange[] {
  const { operation, filePath, isDirectory } = fsChange;

  console.log(
    `[OPTIMISTIC_UPDATE] ${operation} ${filePath} (isDirectory: ${isDirectory})`
  );

  // Skip directory changes for now (we focus on files)
  if (isDirectory) {
    console.log(`[OPTIMISTIC_UPDATE] Skipping directory change: ${filePath}`);
    return existingChanges;
  }

  // Remove existing entry for this file (if any)
  const filtered = existingChanges.filter(
    (change) => change.filePath !== filePath
  );
  const wasExisting = filtered.length !== existingChanges.length;

  // Handle each operation type
  switch (operation) {
    case "file-created":
      console.log(`[OPTIMISTIC_UPDATE] Adding new file: ${filePath}`);
      return [
        ...filtered,
        {
          filePath,
          operation: "CREATE",
          additions: 0, // Will be updated by background git refresh
          deletions: 0,
          createdAt: new Date().toISOString(),
        },
      ];

    case "file-modified":
      console.log(
        `[OPTIMISTIC_UPDATE] Updating existing file: ${filePath} (was existing: ${wasExisting})`
      );
      return [
        ...filtered,
        {
          filePath,
          operation: wasExisting ? "UPDATE" : "CREATE",
          additions: 0, // Will be updated by background git refresh
          deletions: 0,
          createdAt: new Date().toISOString(),
        },
      ];

    case "file-deleted":
      console.log(`[OPTIMISTIC_UPDATE] Removing deleted file: ${filePath}`);
      return filtered;

    case "directory-created":
    case "directory-deleted":
      console.log(
        `[OPTIMISTIC_UPDATE] Ignoring directory operation: ${operation} ${filePath}`
      );
      return existingChanges;

    default:
      console.warn(
        `[OPTIMISTIC_UPDATE] Unknown operation: ${operation} ${filePath}`
      );
      return existingChanges;
  }
}

export function useTaskSocket(taskId: string | undefined) {
  const { socket, isConnected } = useSocket();
  const queryClient = useQueryClient();

  // All the state that was previously in task-content.tsx
  const [streamingAssistantParts, setStreamingAssistantParts] = useState<
    AssistantMessagePart[]
  >([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Join/leave task room
  useEffect(() => {
    if (socket && taskId && isConnected) {
      socket.emit("join-task", { taskId });
      console.log(`[SOCKET] Joined task room: ${taskId}`);

      return () => {
        socket.emit("leave-task", { taskId });
        console.log(`[SOCKET] Left task room: ${taskId}`);
      };
    }
  }, [socket, taskId, isConnected]);

  // All the chat event handlers (moved from task-content.tsx)
  useEffect(() => {
    if (!socket || !taskId) return;

    function onConnect() {
      socket.emit("get-chat-history", { taskId: taskId!, complete: false });
    }

    function onDisconnect() {
      console.log("[TASK-SOCKET] Disconnected");
    }

    function onChatHistory(data: {
      taskId: string;
      messages: Message[];
      queuedMessage: string | null;
    }) {
      if (data.taskId === taskId) {
        const mostRecentMessageModel = getMostRecentMessageModel(data.messages);
        queryClient.setQueryData<TaskMessages>(["task-messages", taskId], {
          messages: data.messages,
          mostRecentMessageModel,
        });
        queryClient.setQueryData(
          ["queued-message", taskId],
          data.queuedMessage
        );

        setStreamingAssistantParts([]);
        setIsStreaming(false);
      }
    }

    function onStreamState(state: { content: string; isStreaming: boolean }) {
      console.log("Received stream state:", state);
      setIsStreaming(state.isStreaming);
    }

    function onStreamChunk(chunk: StreamChunk) {
      setIsStreaming(true);

      // Handle different types of stream chunks
      switch (chunk.type) {
        case "content":
          if (chunk.content) {
            const textPart: TextPart = {
              type: "text",
              text: chunk.content,
            };
            setStreamingAssistantParts((prev) => [...prev, textPart]);
          }
          break;

        case "tool-call":
          if (chunk.toolCall) {
            console.log("Tool call:", chunk.toolCall);

            const toolCallPart: ToolCallPart = {
              type: "tool-call",
              toolCallId: chunk.toolCall.id,
              toolName: chunk.toolCall.name,
              args: chunk.toolCall.args,
            };
            setStreamingAssistantParts((prev) => [...prev, toolCallPart]);
          }
          break;

        case "tool-result":
          if (chunk.toolResult) {
            console.log("Tool result:", chunk.toolResult);

            const toolResultPart: ToolResultPart = {
              type: "tool-result",
              toolCallId: chunk.toolResult.id,
              toolName: "", // We'll find the tool name from the corresponding call
              result: chunk.toolResult.result,
            };

            // Find the corresponding tool call to get the tool name
            setStreamingAssistantParts((prev) => {
              const correspondingCall = prev.find(
                (part) =>
                  part.type === "tool-call" &&
                  part.toolCallId === chunk.toolResult!.id
              );
              if (correspondingCall && correspondingCall.type === "tool-call") {
                toolResultPart.toolName = correspondingCall.toolName;
              }
              return [...prev, toolResultPart];
            });
          }
          break;

        case "fs-change":
          if (chunk.fsChange) {
            console.log("File system change:", chunk.fsChange);

            queryClient.setQueryData(
              ["task", taskId],
              (oldData: TaskWithDetails) => {
                if (!oldData) return oldData;

                const updatedFileChanges = updateFileChangesOptimistically(
                  oldData.fileChanges || [],
                  chunk.fsChange!
                );

                return {
                  ...oldData,
                  fileChanges: updatedFileChanges,
                };
              }
            );

            queryClient.setQueryData(
              ["codebase-tree", taskId],
              (oldData: CodebaseTreeResponse) => {
                if (!oldData || !oldData.success || !oldData.tree)
                  return oldData;

                const updatedTree = updateCodebaseTreeOptimistically(
                  oldData.tree,
                  chunk.fsChange!
                );

                return {
                  ...oldData,
                  tree: updatedTree,
                };
              }
            );

            // Note: Diff stats aren't invalidated here to avoid recomputation on every change
            // They will refresh on: 1) stream completion, 2) 30s stale time, 3) manual refresh
          }
          break;

        case "complete":
          setIsStreaming(false);
          console.log("Stream completed");
          if (taskId) {
            socket.emit("get-chat-history", { taskId, complete: true });
          }
          break;

        case "error": {
          setIsStreaming(false);
          console.error("Stream error:", chunk.error);
          break;
        }

        case "usage":
          console.log("Usage:", chunk.usage);
          break;

        case "thinking":
          console.log("Thinking:", chunk.thinking);
          break;

        case "init-progress":
          if (chunk.initProgress) {
            console.log("Initialization progress:", chunk.initProgress);

            // Optimistically update task initialization state
            queryClient.setQueryData(
              ["task", taskId],
              (oldData: TaskWithDetails) => {
                if (!oldData) return oldData;
                return {
                  ...oldData,
                  task: {
                    ...oldData.task,
                    initStatus:
                      chunk.initProgress?.initStatus ||
                      chunk.initProgress?.currentStep ||
                      oldData.task?.initStatus,
                    initializationError: chunk.initProgress?.error || null,
                    updatedAt: new Date().toISOString(),
                  },
                };
              }
            );

            queryClient.setQueryData(["tasks"], (oldTasks: Task[]) => {
              if (oldTasks) {
                return oldTasks.map((task: Task) =>
                  task.id === taskId
                    ? {
                        ...task,
                        initStatus:
                          chunk.initProgress?.initStatus ||
                          chunk.initProgress?.currentStep ||
                          task.initStatus,
                        initializationError: chunk.initProgress?.error || null,
                        updatedAt: new Date().toISOString(),
                      }
                    : task
                );
              }
              return oldTasks;
            });
          }
          break;

        case "todo-update":
          if (chunk.todoUpdate) {
            console.log("Todo update:", chunk.todoUpdate);
            const todos = chunk.todoUpdate.todos;

            queryClient.setQueryData(
              ["task", taskId],
              (oldData: TaskWithDetails) => {
                if (!oldData) return oldData;

                // Create a map of existing todos by ID for efficient lookup
                const existingTodosMap = new Map(
                  (oldData.todos || []).map((todo) => [todo.id, todo])
                );

                todos.forEach((incomingTodo) => {
                  const existingTodo = existingTodosMap.get(incomingTodo.id);

                  if (existingTodo) {
                    existingTodosMap.set(incomingTodo.id, {
                      ...existingTodo,
                      ...incomingTodo,
                      status: incomingTodo.status.toUpperCase() as TodoStatus,
                      sequence: incomingTodo.sequence,
                      updatedAt: new Date(),
                    });
                  } else {
                    existingTodosMap.set(incomingTodo.id, {
                      ...incomingTodo,
                      status: incomingTodo.status.toUpperCase() as TodoStatus,
                      taskId: taskId!,
                      sequence: incomingTodo.sequence,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    });
                  }
                });

                return {
                  ...oldData,
                  todos: Array.from(existingTodosMap.values()).sort(
                    (a, b) => a.sequence - b.sequence
                  ),
                };
              }
            );
          }
          break;
      }
    }

    function onStreamComplete() {
      setIsStreaming(false);
      console.log("Stream completed");
      if (taskId) {
        socket.emit("get-chat-history", { taskId, complete: true });
      }

      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task-messages", taskId] });
      queryClient.invalidateQueries({ queryKey: ["codebase-tree", taskId] });
    }

    function onStreamError(error: unknown) {
      setIsStreaming(false);
      console.error("Stream error:", error);
      // Legacy stream errors are for unexpected system failures only
      // Don't add error text parts - these errors won't have permanent message parts
    }

    function onMessageError(data: { error: string }) {
      console.error("Message error:", data.error);
      setIsStreaming(false);
    }

    function onTaskStatusUpdate(data: TaskStatusUpdateEvent) {
      if (data.taskId === taskId) {
        console.log(`[TASK_SOCKET] Received task status update:`, data);

        queryClient.setQueryData(
          ["task", taskId],
          (oldData: TaskWithDetails) => {
            if (oldData && oldData.task) {
              return {
                ...oldData,
                task: {
                  ...oldData.task,
                  status: data.status,
                  initStatus: data.initStatus || oldData.task.initStatus,
                  updatedAt: data.timestamp,
                },
              };
            }
            return oldData;
          }
        );

        queryClient.setQueryData(["tasks"], (oldTasks: Task[]) => {
          if (oldTasks) {
            return oldTasks.map((task: Task) =>
              task.id === taskId
                ? { 
                    ...task, 
                    status: data.status, 
                    initStatus: data.initStatus || task.initStatus,
                    updatedAt: data.timestamp 
                  }
                : task
            );
          }
          return oldTasks;
        });
      }
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("chat-history", onChatHistory);
    socket.on("stream-state", onStreamState);
    socket.on("stream-chunk", onStreamChunk);
    socket.on("stream-complete", onStreamComplete);
    socket.on("stream-error", onStreamError);
    socket.on("message-error", onMessageError);
    socket.on("task-status-updated", onTaskStatusUpdate);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("chat-history", onChatHistory);
      socket.off("stream-state", onStreamState);
      socket.off("stream-chunk", onStreamChunk);
      socket.off("stream-complete", onStreamComplete);
      socket.off("stream-error", onStreamError);
      socket.off("message-error", onMessageError);
      socket.off("task-status-updated", onTaskStatusUpdate);
    };
  }, [socket, taskId, queryClient]);

  // Socket actions (methods to call from components)
  const sendMessage = useCallback(
    (message: string, model: string, queue: boolean = false) => {
      if (!socket || !taskId || !message.trim()) return;

      console.log("Sending message:", { taskId, message, model, queue });
      socket.emit("user-message", {
        taskId,
        message: message.trim(),
        llmModel: model as ModelType,
        queue,
      });
    },
    [socket, taskId]
  );

  const stopStream = useCallback(() => {
    if (!socket || !taskId || !isStreaming) return;

    console.log("Stopping stream for task:", taskId);
    socket.emit("stop-stream", { taskId });
    setIsStreaming(false);
    setStreamingAssistantParts([]);
  }, [socket, taskId, isStreaming]);

  const clearQueuedMessage = useCallback(() => {
    if (!socket || !taskId) return;
    socket.emit("clear-queued-message", { taskId });
  }, [socket, taskId]);

  return {
    isConnected,
    streamingAssistantParts,
    isStreaming,
    sendMessage,
    stopStream,
    clearQueuedMessage,
  };
}
