"use client";

import { Messages } from "@/components/chat/messages";
import { PromptForm } from "@/components/chat/prompt-form";
import { ScrollToBottom } from "@/hooks/use-is-at-top";
import { useSendMessage } from "@/hooks/use-send-message";
import { useTaskMessages } from "@/hooks/use-task-messages";
import { socket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { FileChange, Task } from "@repo/db";
import type {
  AssistantMessagePart,
  Message,
  StreamChunk,
  TaskStatusUpdateEvent,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from "@repo/types";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { StickToBottom } from "use-stick-to-bottom";

export function TaskPageContent({ isAtTop }: { isAtTop: boolean }) {
  const { taskId } = useParams<{ taskId: string }>();

  const queryClient = useQueryClient();

  const { data: messages = [], error: taskMessagesError } =
    useTaskMessages(taskId);
  const sendMessageMutation = useSendMessage();

  // Streaming state for structured assistant parts
  const [streamingAssistantParts, setStreamingAssistantParts] = useState<
    AssistantMessagePart[]
  >([]);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    function onConnect() {
      // Request chat history when connected
      if (taskId) {
        socket.emit("get-chat-history", { taskId });
      }
    }

    function onDisconnect() {
      // Connection lost
    }

    function onChatHistory(data: { taskId: string; messages: Message[] }) {
      if (data.taskId === taskId) {
        // Update the query cache directly with fresh data from server
        queryClient.setQueryData(["task-messages", taskId], data.messages);

        // Clear streaming state when we have the updated chat history
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
            // Add text part to structured assistant parts
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

            // Add tool call part to structured assistant parts
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

            // Add tool result part to structured assistant parts
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

        case "file-change":
          if (chunk.fileChange) {
            console.log("File change:", chunk.fileChange);

            // Optimistic update: Use chunk data directly instead of invalidating query
            queryClient.setQueryData<FileChange[]>(
              ["file-changes", taskId],
              (oldData = []) => {
                const chunkFileChange = chunk.fileChange!;

                // Transform chunk data to match FileChange type
                const newFileChange: FileChange = {
                  ...chunkFileChange,
                  taskId,
                  oldContent: chunkFileChange.oldContent ?? null,
                  newContent: chunkFileChange.newContent ?? null,
                  diffPatch: chunkFileChange.diffPatch ?? null,
                  createdAt: new Date(chunkFileChange.createdAt),
                };

                // Handle deduplication - replace existing entry for same file
                const filteredData = oldData.filter(
                  (change) => change.filePath !== newFileChange.filePath
                );

                // Add the new/updated file change
                return [...filteredData, newFileChange];
              }
            );
          }
          break;

        case "complete":
          setIsStreaming(false);
          console.log("Stream completed");
          socket.emit("get-chat-history", { taskId });
          break;

        case "error": {
          setIsStreaming(false);
          console.error("Stream error:", chunk.error);

          // Add error text part to structured assistant parts
          const errorTextPart: TextPart = {
            type: "text",
            text: `\n\nError: ${chunk.error}`,
          };
          setStreamingAssistantParts((prev) => [...prev, errorTextPart]);
          break;
        }

        case "usage":
          console.log("Usage:", chunk.usage);
          break;

        case "thinking":
          console.log("Thinking:", chunk.thinking);
          break;
      }
    }

    function onStreamComplete() {
      setIsStreaming(false);
      console.log("Stream completed");
      // Refresh messages when stream is complete
      socket.emit("get-chat-history", { taskId });

      queryClient.invalidateQueries({ queryKey: ["file-changes", taskId] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }

    function onStreamError(error: any) {
      setIsStreaming(false);
      console.error("Stream error:", error);

      // Add error to structured parts
      const errorTextPart: TextPart = {
        type: "text",
        text: "\n\nStream error occurred",
      };
      setStreamingAssistantParts((prev) => [...prev, errorTextPart]);
    }

    function onMessageError(data: { error: string }) {
      console.error("Message error:", data.error);
      setIsStreaming(false);
    }

    function onTaskStatusUpdate(data: TaskStatusUpdateEvent) {
      if (data.taskId === taskId) {
        // Optimistically update the task status in React Query cache
        queryClient.setQueryData(
          ["task", taskId],
          (oldData: Task | undefined) => {
            if (oldData) {
              return {
                ...oldData,
                status: data.status,
                updatedAt: data.timestamp,
              };
            }
            return oldData;
          }
        );

        queryClient.setQueryData(["tasks"], (oldTasks: Task[]) => {
          if (oldTasks) {
            return oldTasks.map((task: Task) =>
              task.id === taskId
                ? { ...task, status: data.status, updatedAt: data.timestamp }
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

    if (!socket.connected) {
      socket.connect();
    }

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
  }, [taskId]);

  const handleSendMessage = (message: string, model: string) => {
    if (!taskId || !message.trim()) return;

    // Use the mutation for optimistic updates
    sendMessageMutation.mutate({ taskId, message, model });

    console.log("Sending message:", { taskId, message, model });
    socket.emit("user-message", {
      taskId,
      message: message.trim(),
      llmModel: model,
    });
  };

  const handleStopStream = () => {
    if (!taskId || !isStreaming) return;

    console.log("Stopping stream for task:", taskId);
    socket.emit("stop-stream", { taskId });

    // Immediately update local state
    setIsStreaming(false);
    setStreamingAssistantParts([]);
  };

  if (taskMessagesError) {
    return (
      <div className="mx-auto flex w-full max-w-lg grow flex-col items-center justify-center">
        <div className="text-destructive">
          Error fetching messages: {taskMessagesError.message}
        </div>
      </div>
    );
  }

  // Combine real messages with current streaming content
  const displayMessages = [...messages];

  // Add streaming assistant message with structured parts if present
  if (streamingAssistantParts.length > 0 || isStreaming) {
    displayMessages.push({
      id: "streaming",
      role: "assistant",
      content: "", // Content will come from parts
      createdAt: new Date().toISOString(),
      metadata: {
        isStreaming: true,
        parts: streamingAssistantParts,
      },
    });
  }

  return (
    <StickToBottom.Content className="relative z-0 mx-auto flex min-h-full w-full max-w-lg flex-col items-center px-4 sm:px-6">
      <div
        className={cn(
          "from-background via-background/60 pointer-events-none sticky top-0 -left-px z-10 h-16 w-[calc(100%+2px)] -translate-y-px bg-gradient-to-b to-transparent transition-opacity",
          isAtTop ? "opacity-0" : "opacity-100"
        )}
      />

      <Messages messages={displayMessages} />

      <ScrollToBottom />

      <PromptForm
        onSubmit={handleSendMessage}
        onStopStream={handleStopStream}
        isStreaming={isStreaming || sendMessageMutation.isPending}
      />
    </StickToBottom.Content>
  );
}
