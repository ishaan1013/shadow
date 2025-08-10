"use client";

import { useSocket } from "./use-socket";
import { StreamingStatus } from "@/lib/constants";
import { useEffect, useState, useCallback, useRef } from "react";
import { extractStreamingArgs } from "@/lib/streaming-args";
import { useStreamingPartsMap } from "../use-streaming-parts-map";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AssistantMessagePart,
  Message,
  StreamChunk,
  TaskStatusUpdateEvent,
  AutoPRStatusEvent,
  ModelType,
  FileNode,
  QueuedActionUI,
  ToolCallPart,
  ReasoningPart,
  RedactedReasoningPart,
} from "@repo/types";
import { TextPart, ToolResultPart } from "ai";
import type { TaskWithDetails } from "@/lib/db-operations/get-task-with-details";
import { CodebaseTreeResponse } from "../use-codebase-tree";
import { Task, TodoStatus } from "@repo/db";
import { TaskStatusData } from "@/lib/db-operations/get-task-status";

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

  // Skip directory changes for now (we focus on files)
  if (isDirectory) {
    return existingChanges;
  }

  // Find existing entry for this file to preserve additions/deletions
  const existingFile = existingChanges.find(
    (change) => change.filePath === filePath
  );
  const filtered = existingChanges.filter(
    (change) => change.filePath !== filePath
  );
  const wasExisting = existingFile !== undefined;

  // Handle each operation type
  switch (operation) {
    case "file-created":
      return [
        ...filtered,
        {
          filePath,
          operation: "CREATE",
          additions: 0, // New files start with 0 until git computes actual stats
          deletions: 0,
          createdAt: new Date().toISOString(),
        },
      ];

    case "file-modified":
      return [
        ...filtered,
        {
          filePath,
          operation: wasExisting ? "UPDATE" : "CREATE",
          // Preserve existing additions/deletions if file was already tracked
          additions: existingFile?.additions ?? 0,
          deletions: existingFile?.deletions ?? 0,
          createdAt: existingFile?.createdAt ?? new Date().toISOString(),
        },
      ];

    case "file-deleted":
      return filtered;

    case "directory-created":
    case "directory-deleted":
      return existingChanges;

    default:
      return existingChanges;
  }
}

export function useTaskSocket(taskId: string | undefined) {
  const { socket, isConnected } = useSocket();
  const queryClient = useQueryClient();

  const streamingParts = useStreamingPartsMap();
  const [streamingPartsOrder, setStreamingPartsOrder] = useState<string[]>([]);
  const [streamingStatus, setStreamingStatus] = useState(StreamingStatus.IDLE);

  // Auto-PR state management
  const [autoPRStatus, setAutoPRStatus] = useState<AutoPRStatusEvent | null>(
    null
  );

  // Ref counters for ID generation (no re-renders needed)
  const textCounterRef = useRef(0);
  const redactedReasoningCounterRef = useRef(0);
  const reasoningCounterRef = useRef(0);

  const addStreamingPart = useCallback(
    (part: AssistantMessagePart, id: string) => {
      streamingParts.update((prev) => {
        const newMap = new Map(prev);
        newMap.set(id, part);
        return newMap;
      });
      setStreamingPartsOrder((prev) =>
        prev.includes(id) ? prev : [...prev, id]
      );
    },
    [streamingParts]
  );

  const clearStreamingState = useCallback(() => {
    streamingParts.clear();
    setStreamingPartsOrder([]);
    setStreamingStatus(StreamingStatus.IDLE);

    // Reset all ref counters
    textCounterRef.current = 0;
    redactedReasoningCounterRef.current = 0;
    reasoningCounterRef.current = 0;
  }, [streamingParts]);

  // Join/leave task room
  useEffect(() => {
    if (socket && taskId && isConnected) {
      socket.emit("join-task", { taskId });

      return () => {
        socket.emit("leave-task", { taskId });
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
      queuedAction: QueuedActionUI | null;
    }) {
      if (data.taskId === taskId) {
        queryClient.setQueryData<Message[]>(
          ["task-messages", taskId],
          data.messages
        );
        queryClient.setQueryData(["queued-action", taskId], data.queuedAction);

        clearStreamingState();
      }
    }

    function onStreamState(state: {
      chunks: StreamChunk[];
      isStreaming: boolean;
      totalChunks: number;
    }) {
      setStreamingStatus(
        state.isStreaming ? StreamingStatus.STREAMING : StreamingStatus.IDLE
      );

      // Replay chunks to reconstruct streaming parts
      if (state.chunks && state.chunks.length > 0) {
        const newPartsMap = new Map<string, AssistantMessagePart>();
        const newPartsOrder: string[] = [];
        let textCounter = 0;

        // Track counters during replay
        let replayReasoningCounter = 0;
        let replayRedactedReasoningCounter = 0;

        state.chunks.forEach((chunk) => {
          if (chunk.type === "content" && chunk.content) {
            const partId = `text-${textCounter++}`;
            const textPart: TextPart = {
              type: "text",
              text: chunk.content,
            };
            newPartsMap.set(partId, textPart);
            newPartsOrder.push(partId);
          } else if (chunk.type === "tool-call-start" && chunk.toolCallStart) {
            const partId = chunk.toolCallStart.id;
            const toolCallStartPart: ToolCallPart = {
              type: "tool-call",
              toolCallId: chunk.toolCallStart.id,
              toolName: chunk.toolCallStart.name,
              args: {}, // Empty initially
              streamingState: "starting",
              argsComplete: false,
            };
            newPartsMap.set(partId, toolCallStartPart);
            newPartsOrder.push(partId);
          } else if (chunk.type === "tool-call-delta" && chunk.toolCallDelta) {
            const partId = chunk.toolCallDelta.id;
            // Update existing part if it exists
            const existingPart = newPartsMap.get(partId);
            if (existingPart?.type === "tool-call") {
              const updatedPart: ToolCallPart = {
                ...existingPart,
                streamingState: "streaming",
              };
              newPartsMap.set(partId, updatedPart);
            }
          } else if (chunk.type === "tool-call" && chunk.toolCall) {
            const partId = chunk.toolCall.id;
            // Check if we already have a starting version
            const existingPart = newPartsMap.get(partId);
            const toolCallPart: ToolCallPart = {
              type: "tool-call",
              toolCallId: chunk.toolCall.id,
              toolName: chunk.toolCall.name,
              args: chunk.toolCall.args, // Complete args
              streamingState: "complete",
              argsComplete: true,
            };
            newPartsMap.set(partId, toolCallPart);
            // Only push to order if this is the first time seeing this ID
            if (!existingPart) {
              newPartsOrder.push(partId);
            }
          } else if (chunk.type === "tool-result" && chunk.toolResult) {
            const partId = `${chunk.toolResult.id}-result`;
            const correspondingCall = newPartsMap.get(chunk.toolResult.id);
            const toolName =
              correspondingCall?.type === "tool-call"
                ? correspondingCall.toolName
                : "";

            const toolResultPart: ToolResultPart = {
              type: "tool-result",
              toolCallId: chunk.toolResult.id,
              toolName,
              result: chunk.toolResult.result,
            };
            newPartsMap.set(partId, toolResultPart);
            newPartsOrder.push(partId);
          } else if (chunk.type === "reasoning" && chunk.reasoning) {
            // Add reasoning immediately to parts map for live streaming
            const partId = `reasoning-${replayReasoningCounter}`;
            const existingPart = newPartsMap.get(partId);

            const updatedReasoning: ReasoningPart = {
              type: "reasoning" as const,
              text:
                (existingPart?.type === "reasoning" ? existingPart.text : "") +
                chunk.reasoning,
            };

            newPartsMap.set(partId, updatedReasoning);
            if (!newPartsOrder.includes(partId)) {
              newPartsOrder.push(partId);
            }
          } else if (
            chunk.type === "reasoning-signature" &&
            chunk.reasoningSignature
          ) {
            // Update existing reasoning part with signature
            const partId = `reasoning-${replayReasoningCounter}`;
            const existingReasoning = newPartsMap.get(partId);

            if (existingReasoning?.type === "reasoning") {
              const finalizedReasoning: ReasoningPart = {
                ...existingReasoning,
                signature: chunk.reasoningSignature,
              };

              newPartsMap.set(partId, finalizedReasoning);
              replayReasoningCounter++;
            }
          } else if (
            chunk.type === "redacted-reasoning" &&
            chunk.redactedReasoningData
          ) {
            const redactedReasoningPart: RedactedReasoningPart = {
              type: "redacted-reasoning",
              data: chunk.redactedReasoningData,
            };

            const partId = `redacted-reasoning-${replayRedactedReasoningCounter++}`;
            newPartsMap.set(partId, redactedReasoningPart);
            newPartsOrder.push(partId);
          }
        });

        // Sync all ref counters to match replayed state
        textCounterRef.current = textCounter;
        redactedReasoningCounterRef.current = replayRedactedReasoningCounter;
        reasoningCounterRef.current = replayReasoningCounter;

        streamingParts.update(() => newPartsMap);
        setStreamingPartsOrder(newPartsOrder);
      }
    }

    function onStreamChunk(chunk: StreamChunk) {
      setStreamingStatus(StreamingStatus.STREAMING);

      // Handle different types of stream chunks
      switch (chunk.type) {
        case "content":
          if (chunk.content) {
            const textPart: TextPart = {
              type: "text",
              text: chunk.content,
            };
            addStreamingPart(textPart, `text-${textCounterRef.current++}`);
          }
          break;

        case "tool-call":
          if (chunk.toolCall) {
            const toolCallPart: ToolCallPart = {
              type: "tool-call",
              toolCallId: chunk.toolCall.id,
              toolName: chunk.toolCall.name,
              args: chunk.toolCall.args,
              streamingState: "complete",
              argsComplete: true,
            };
            addStreamingPart(toolCallPart, chunk.toolCall.id);
          }
          break;

        case "tool-call-start":
          if (chunk.toolCallStart) {
            const toolCallStartPart: ToolCallPart = {
              type: "tool-call",
              toolCallId: chunk.toolCallStart.id,
              toolName: chunk.toolCallStart.name,
              args: {},
              streamingState: "starting",
              argsComplete: false,
            };

            addStreamingPart(toolCallStartPart, chunk.toolCallStart.id);
          }
          break;

        case "tool-call-delta":
          if (chunk.toolCallDelta) {
            const existingPart = streamingParts.current.get(
              chunk.toolCallDelta.id
            );
            if (existingPart?.type === "tool-call") {
              const newAccumulatedText =
                (existingPart.accumulatedArgsText || "") +
                chunk.toolCallDelta.argsTextDelta;

              const partialArgs = extractStreamingArgs(
                newAccumulatedText,
                chunk.toolCallDelta.name
              );

              const updatedPart: ToolCallPart = {
                ...existingPart,
                streamingState: "streaming",
                accumulatedArgsText: newAccumulatedText,
                partialArgs,
              };
              addStreamingPart(updatedPart, chunk.toolCallDelta.id);
            }
          }
          break;

        case "tool-result":
          if (chunk.toolResult) {
            const correspondingCall = streamingParts.current.get(
              chunk.toolResult.id
            );
            const toolName =
              correspondingCall?.type === "tool-call"
                ? correspondingCall.toolName
                : "";

            const toolResultPart: ToolResultPart = {
              type: "tool-result",
              toolCallId: chunk.toolResult.id,
              toolName,
              result: chunk.toolResult.result,
            };

            addStreamingPart(toolResultPart, `${chunk.toolResult.id}-result`);
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

                // Calculate diffStats from the updated fileChanges array
                // Same logic as backend: git-operations.ts:390-397
                const updatedDiffStats = updatedFileChanges.reduce(
                  (acc, file) => ({
                    additions: acc.additions + file.additions,
                    deletions: acc.deletions + file.deletions,
                    totalFiles: acc.totalFiles + 1,
                  }),
                  { additions: 0, deletions: 0, totalFiles: 0 }
                );

                return {
                  ...oldData,
                  fileChanges: updatedFileChanges,
                  diffStats: updatedDiffStats,
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
          }
          break;

        case "fs-override":
          if (chunk.fsOverride) {
            console.log("File state override:", chunk.fsOverride.message);

            // Replace entire file state (not optimistic merge)
            queryClient.setQueryData(
              ["task", taskId],
              (oldData: TaskWithDetails) => {
                if (!oldData) return oldData;
                return {
                  ...oldData,
                  fileChanges: chunk.fsOverride!.fileChanges,
                  diffStats: chunk.fsOverride!.diffStats,
                };
              }
            );

            queryClient.setQueryData(
              ["codebase-tree", taskId],
              (oldData: CodebaseTreeResponse) => {
                if (!oldData) return oldData;
                return {
                  success: true,
                  tree: chunk.fsOverride!.codebaseTree,
                };
              }
            );
          }
          break;

        case "complete":
          setStreamingStatus(StreamingStatus.IDLE);
          break;

        case "error": {
          setStreamingStatus(StreamingStatus.IDLE);
          console.error("Stream error:", chunk.error);
          break;
        }

        case "usage":
          console.log("Usage:", chunk.usage);
          break;

        case "reasoning":
          if (chunk.reasoning) {
            // Add reasoning immediately to streaming parts for live streaming
            const partId = `reasoning-${reasoningCounterRef.current}`;
            const existingPart = streamingParts.current.get(partId);

            const updatedReasoning: ReasoningPart = {
              type: "reasoning",
              text:
                (existingPart?.type === "reasoning" ? existingPart.text : "") +
                chunk.reasoning,
            };

            addStreamingPart(updatedReasoning, partId);
          }
          break;

        case "reasoning-signature":
          if (chunk.reasoningSignature) {
            // Update existing reasoning part in streaming parts with signature
            const partId = `reasoning-${reasoningCounterRef.current}`;
            const existingPart = streamingParts.current.get(partId);

            if (existingPart?.type === "reasoning") {
              const finalizedReasoning: ReasoningPart = {
                ...existingPart,
                signature: chunk.reasoningSignature,
              };

              addStreamingPart(finalizedReasoning, partId);
              reasoningCounterRef.current++;
            }
          }
          break;

        case "redacted-reasoning":
          if (chunk.redactedReasoningData) {
            const redactedReasoningPart: RedactedReasoningPart = {
              type: "redacted-reasoning",
              data: chunk.redactedReasoningData,
            };

            addStreamingPart(
              redactedReasoningPart,
              `redacted-reasoning-${redactedReasoningCounterRef.current++}`
            );
          }
          break;

        case "init-progress":
          if (chunk.initProgress) {

            queryClient.setQueryData(
              ["task", taskId],
              (oldData: TaskWithDetails) => {
                if (!oldData) return oldData;
                return {
                  ...oldData,
                  task: {
                    ...oldData.task,
                    initStatus:
                      chunk.initProgress?.currentStep ||
                      oldData.task?.initStatus,
                    initializationError: chunk.initProgress?.error || null,
                    updatedAt: new Date().toISOString(),
                  },
                };
              }
            );

            queryClient.setQueryData(
              ["task-status", taskId],
              (oldData: TaskStatusData) => {
                if (!oldData) return oldData;
                return {
                  ...oldData,
                  initStatus:
                    chunk.initProgress?.currentStep || oldData.initStatus,
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
                          chunk.initProgress?.currentStep || task.initStatus,
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
            const action = chunk.todoUpdate.action;

            queryClient.setQueryData(
              ["task", taskId],
              (oldData: TaskWithDetails) => {
                if (!oldData) return oldData;

                if (action === "replaced") {
                  // Replace entire todo list with incoming todos
                  const newTodos = todos.map((incomingTodo) => ({
                    ...incomingTodo,
                    status: incomingTodo.status.toUpperCase() as TodoStatus,
                    taskId: taskId!,
                    sequence: incomingTodo.sequence,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  }));

                  return {
                    ...oldData,
                    todos: newTodos.sort((a, b) => a.sequence - b.sequence),
                  };
                } else {
                  // Merge/update existing todos (default behavior)
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
              }
            );
          }
          break;
      }
    }

    function onStreamComplete() {
      clearStreamingState();
      console.log("Stream completed");
      if (taskId) {
        socket.emit("get-chat-history", { taskId, complete: true });
      }

      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task-messages", taskId] });
      queryClient.invalidateQueries({ queryKey: ["codebase-tree", taskId] });
      queryClient.invalidateQueries({ queryKey: ["codebases"] });
    }

    function onStreamError(error: unknown) {
      clearStreamingState();
      console.error("Stream error:", error);
    }

    function onMessageError(data: { error: string }) {
      console.error("Message error:", data.error);
      clearStreamingState();
    }

    function onQueuedActionProcessing(data: {
      taskId: string;
      type: "message" | "stacked-pr";
      message: string;
      model: ModelType;
      shadowBranch?: string;
      title?: string;
    }) {
      if (data.taskId === taskId) {
        console.log(`[TASK_SOCKET] Processing queued ${data.type}:`, data);

        const optimisticMessage: Message = {
          id: `temp-queued-${Date.now()}`,
          role: "user",
          content: data.message.trim(),
          llmModel: data.model,
          createdAt: new Date().toISOString(),
          metadata: { isStreaming: false },
          pullRequestSnapshot: undefined,
          ...(data.type === "stacked-pr" &&
            data.shadowBranch && {
              stackedTask: {
                id: "temp",
                title: data.title || data.message.trim(),
                shadowBranch: data.shadowBranch,
              },
            }),
        };

        queryClient.setQueryData<Message[]>(
          ["task-messages", taskId],
          (old) => {
            const currentMessages = old || [];

            const hasTempMessage = currentMessages.some(
              (msg) =>
                msg.id.startsWith("temp-queued-") &&
                msg.content === data.message.trim() &&
                msg.role === "user"
            );

            if (hasTempMessage) {
              return old || currentMessages;
            }

            const updatedMessages = [...currentMessages, optimisticMessage];

            return updatedMessages;
          }
        );

        queryClient.setQueryData(["queued-action", taskId], null);
      }
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

        queryClient.setQueryData(
          ["task-status", taskId],
          (oldData: TaskStatusData) => {
            if (!oldData) return oldData;
            return {
              ...oldData,
              status: data.status,
            };
          }
        );

        queryClient.invalidateQueries({ queryKey: ["codebase-tree", taskId] });

        if (data.status === "RUNNING") {
          queryClient.invalidateQueries({ queryKey: ["codebases"] });
        }

        queryClient.setQueryData(["tasks"], (oldTasks: Task[]) => {
          if (oldTasks) {
            return oldTasks.map((task: Task) =>
              task.id === taskId
                ? {
                    ...task,
                    status: data.status,
                    initStatus: data.initStatus || task.initStatus,
                    updatedAt: data.timestamp,
                  }
                : task
            );
          }
          return oldTasks;
        });
      }
    }

    function onAutoPRStatus(data: AutoPRStatusEvent) {
      if (data.taskId === taskId) {
        console.log(`[TASK_SOCKET] Received auto-PR status update:`, data);
        setAutoPRStatus(data);

        // Handle different auto-PR statuses
        switch (data.status) {
          case "completed":
            // Optimistically update task with PR number if provided
            if (data.prNumber) {
              queryClient.setQueryData(
                ["task", taskId],
                (oldData: TaskWithDetails) => {
                  if (oldData && oldData.task) {
                    return {
                      ...oldData,
                      task: {
                        ...oldData.task,
                        pullRequestNumber: data.prNumber,
                      },
                    };
                  }
                  return oldData;
                }
              );
            }
            // Clear the auto-PR status after a short delay to allow UI transition
            setTimeout(() => setAutoPRStatus(null), 2000);
            break;

          case "failed":
            // Show error toast and clear status
            if (typeof window !== "undefined") {
              import("sonner").then(({ toast }) => {
                toast.error(data.error || "Failed to create pull request");
              });
            }
            setTimeout(() => setAutoPRStatus(null), 1000);
            break;
        }
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
    socket.on("queued-action-processing", onQueuedActionProcessing);
    socket.on("task-status-updated", onTaskStatusUpdate);
    socket.on("auto-pr-status", onAutoPRStatus);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("chat-history", onChatHistory);
      socket.off("stream-state", onStreamState);
      socket.off("stream-chunk", onStreamChunk);
      socket.off("stream-complete", onStreamComplete);
      socket.off("stream-error", onStreamError);
      socket.off("message-error", onMessageError);
      socket.off("queued-action-processing", onQueuedActionProcessing);
      socket.off("task-status-updated", onTaskStatusUpdate);
      socket.off("auto-pr-status", onAutoPRStatus);
    };
  }, [socket, taskId, queryClient]);

  // Socket actions (methods to call from components)
  const sendMessage = useCallback(
    (message: string, model: string, queue: boolean = false) => {
      if (!socket || !taskId || !message.trim()) return;

      console.log("Sending message:", { taskId, message, model, queue });
      setStreamingStatus(StreamingStatus.PENDING);
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
    if (!socket || !taskId || streamingStatus === StreamingStatus.IDLE) return;

    console.log("Stopping stream for task:", taskId);
    socket.emit("stop-stream", { taskId });
    clearStreamingState();
  }, [socket, taskId, streamingStatus, clearStreamingState]);

  const clearQueuedAction = useCallback(() => {
    if (!socket || !taskId) return;
    socket.emit("clear-queued-action", { taskId });
  }, [socket, taskId]);

  const createStackedPR = useCallback(
    (message: string, model: string, queue: boolean = false) => {
      if (!socket || !taskId || !message.trim()) return;

      socket.emit("create-stacked-pr", {
        taskId,
        message: message.trim(),
        llmModel: model as ModelType,
        queue,
      });
    },
    [socket, taskId]
  );

  return {
    isConnected,
    streamingPartsMap: streamingParts.map,
    streamingPartsOrder,
    streamingStatus,
    setStreamingStatus,
    autoPRStatus,
    sendMessage,
    stopStream,
    clearQueuedAction,
    createStackedPR,
  };
}
