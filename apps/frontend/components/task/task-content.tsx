"use client";

import { Messages } from "@/components/chat/messages";
import { PromptForm } from "@/components/chat/prompt-form";
import { useSendMessage } from "@/hooks/use-send-message";
import { useTaskMessages } from "@/hooks/use-task-messages";
import { useTaskSocket } from "@/hooks/socket";
import { useParams } from "next/navigation";
import { ScrollToBottom } from "./scroll-to-bottom";
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ModelType } from "@repo/types";

export function TaskPageContent() {
  const { taskId } = useParams<{ taskId: string }>();

  const queryClient = useQueryClient();

  const {
    data: { messages = [], mostRecentMessageModel = null } = {},
    error: taskMessagesError,
  } = useTaskMessages(taskId);

  const sendMessageMutation = useSendMessage();

  const { streamingAssistantParts, isStreaming, sendMessage, stopStream } =
    useTaskSocket(taskId);

  const handleSendMessage = useCallback(
    (message: string, model: ModelType, queue: boolean) => {
      if (!taskId || !message.trim()) return;

      // Use the mutation for optimistic updates
      if (!queue) {
        sendMessageMutation.mutate({ taskId, message, model });
      }

      // Send via socket
      sendMessage(message, model, queue);
    },
    [taskId, sendMessageMutation, sendMessage]
  );

  const handleStopStream = useCallback(() => {
    stopStream();
  }, [stopStream]);

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
  const displayMessages = useMemo(() => {
    const msgs = [...messages];

    // Add streaming assistant message with structured parts if present
    if (streamingAssistantParts.length > 0 || isStreaming) {
      msgs.push({
        id: "streaming",
        role: "assistant",
        content: "", // Content will come from parts
        createdAt: new Date().toISOString(),
        llmModel: mostRecentMessageModel || "",
        metadata: {
          isStreaming: true,
          parts: streamingAssistantParts,
        },
      });
    }

    return msgs;
  }, [messages, streamingAssistantParts, isStreaming]);

  return (
    <div className="relative z-0 mx-auto flex w-full max-w-lg grow flex-col items-center px-4 sm:px-6">
      <Messages taskId={taskId} messages={displayMessages} />

      <ScrollToBottom />

      <PromptForm
        onSubmit={handleSendMessage}
        onStopStream={handleStopStream}
        isStreaming={isStreaming || sendMessageMutation.isPending}
        initialSelectedModel={mostRecentMessageModel}
        onFocus={() => {
          queryClient.setQueryData(["edit-message-id", taskId], null);
        }}
      />
    </div>
  );
}
