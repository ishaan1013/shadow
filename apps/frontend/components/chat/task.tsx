"use client";

import { Messages } from "@/components/chat/messages";
import { PromptForm } from "@/components/chat/prompt-form";
import { useSendMessage } from "@/hooks/use-send-message";
import { useTaskMessages } from "@/hooks/use-task-messages";
import type { Task } from "@/lib/db-operations/get-task";
import { queryClient } from "@/lib/query-client";
import { socket } from "@/lib/socket";
import type { Message, StreamChunk, ToolStatusType } from "@repo/types";
import { GitBranch, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

// Types for streaming tool calls
interface StreamingToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  status: ToolStatusType;
  result?: string;
  error?: string;
}

export function TaskPageContent({
  task,
  initialMessages,
}: {
  task: Task;
  initialMessages: Message[];
}) {
  const taskId = task.id;

  const { data: messages = [] } = useTaskMessages(taskId, initialMessages);
  const sendMessageMutation = useSendMessage();

  const [accumulatedContent, setAccumulatedContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingToolCalls, setStreamingToolCalls] = useState<
    StreamingToolCall[]
  >([]);
  const [cloneProgress, setCloneProgress] = useState<{
    status: "cloning" | "completed" | "error";
    message: string;
    progress?: number;
  } | null>(null);

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

        // Clear accumulated content and tool calls when we have the updated chat history
        setAccumulatedContent("");
        setStreamingToolCalls([]);
      }
    }

    function onStreamState(state: { content: string; isStreaming: boolean }) {
      console.log("Received stream state:", state);
      setAccumulatedContent(state.content);
      setIsStreaming(state.isStreaming);
    }

    function onStreamChunk(chunk: StreamChunk) {
      setIsStreaming(true);

      // Handle different types of stream chunks
      switch (chunk.type) {
        case "content":
          if (chunk.content) {
            setAccumulatedContent((prev) => prev + chunk.content);
          }
          break;

        case "tool-call":
          if (chunk.toolCall) {
            console.log("Tool call:", chunk.toolCall);
            const newToolCall: StreamingToolCall = {
              id: chunk.toolCall.id,
              name: chunk.toolCall.name,
              args: chunk.toolCall.args,
              status: "RUNNING",
            };
            setStreamingToolCalls((prev) => [...prev, newToolCall]);
          }
          break;

        case "tool-result":
          if (chunk.toolResult) {
            console.log("Tool result:", chunk.toolResult);
            setStreamingToolCalls((prev) =>
              prev.map((toolCall) =>
                toolCall.id === chunk.toolResult!.id
                  ? {
                      ...toolCall,
                      status: "COMPLETED" as const,
                      result: chunk.toolResult!.result,
                    }
                  : toolCall
              )
            );
          }
          break;

        case "complete":
          setIsStreaming(false);
          console.log("Stream completed");
          socket.emit("get-chat-history", { taskId });
          break;

        case "error":
          setIsStreaming(false);
          console.error("Stream error:", chunk.error);
          setAccumulatedContent((prev) => prev + `\n\nError: ${chunk.error}`);
          break;

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
    }

    function onStreamError(error: any) {
      setIsStreaming(false);
      console.error("Stream error:", error);
      setAccumulatedContent((prev) => prev + "\n\nStream error occurred");
    }

    function onMessageError(data: { error: string }) {
      console.error("Message error:", data.error);
      setIsStreaming(false);
    }

    function onCloneProgress(data: {
      taskId: string;
      status: "cloning" | "completed" | "error";
      message: string;
      progress?: number;
    }) {
      if (data.taskId === taskId) {
        setCloneProgress({
          status: data.status,
          message: data.message,
          progress: data.progress,
        });

        // Auto-hide completed or error states after a delay
        if (data.status === "completed" || data.status === "error") {
          setTimeout(() => {
            setCloneProgress(null);
          }, 3000);
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
    socket.on("clone-progress", onCloneProgress);

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
      socket.off("clone-progress", onCloneProgress);
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

  if (!task) {
    return (
      <div className="mx-auto flex w-full grow max-w-lg flex-col items-center justify-center">
        <div className="text-muted-foreground">Task not found</div>
      </div>
    );
  }

  // Combine real messages with current streaming content and tool calls
  const displayMessages = [...messages];

  // Add streaming tool calls as individual messages
  streamingToolCalls.forEach((toolCall) => {
    displayMessages.push({
      id: `tool-${toolCall.id}`,
      role: "tool",
      content:
        toolCall.result || (toolCall.status === "RUNNING" ? "Running..." : ""),
      createdAt: new Date().toISOString(),
      metadata: {
        tool: {
          name: toolCall.name,
          args: toolCall.args,
          status:
            toolCall.status === "COMPLETED" ? "COMPLETED" : toolCall.status,
          result: toolCall.result,
          error: toolCall.error,
        },
        isStreaming: toolCall.status === "RUNNING",
      },
    });
  });

  // Add streaming assistant content if present
  if (accumulatedContent || isStreaming) {
    displayMessages.push({
      id: "streaming",
      role: "assistant",
      content: accumulatedContent,
      createdAt: new Date().toISOString(),
      metadata: { isStreaming: true },
    });
  }

  const chatContent = (
    <div className="mx-auto flex w-full grow max-w-lg flex-col items-center px-4 sm:px-6 relative z-0">
      {/* Todo: only show if not scrolled to the very top  */}
      <div className="sticky -left-px w-[calc(100%+2px)] top-[calc(3rem+1px)] h-16 bg-gradient-to-b from-background via-background/60 to-transparent -translate-y-px pointer-events-none z-10" />

      {/* Clone Progress Indicator */}
      {cloneProgress && (
        <div className="w-full mb-4 p-4 bg-accent/50 border border-border rounded-lg">
          <div className="flex items-center gap-3">
            {cloneProgress.status === "cloning" && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            )}
            {cloneProgress.status === "completed" && (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
            {cloneProgress.status === "error" && (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <GitBranch className="h-3 w-3" />
                <span className="text-sm font-medium">Repository Setup</span>
              </div>
              <p className="text-sm text-muted-foreground">{cloneProgress.message}</p>
              
              {cloneProgress.progress !== undefined && cloneProgress.status === "cloning" && (
                <div className="mt-2 w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${cloneProgress.progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Messages messages={displayMessages} />
      <PromptForm
        onSubmit={handleSendMessage}
        isStreaming={isStreaming || sendMessageMutation.isPending}
      />
    </div>
  );

  return chatContent;
}
