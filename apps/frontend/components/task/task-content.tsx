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
import { useTaskStatus } from "@/hooks/use-task-status";

export function TaskPageContent() {
  const { taskId } = useParams<{ taskId: string }>();

  const queryClient = useQueryClient();

  const { data } = useTaskStatus(taskId);
  const status = data?.status;

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

    // If streaming and we have parts, merge with existing or create new message
    if (streamingAssistantParts.length > 0 || isStreaming) {
      const lastMsg = msgs[msgs.length - 1];

      if (lastMsg && lastMsg.role.toLowerCase() === "assistant") {
        // Merge existing parts with streaming parts
        const existingParts = lastMsg.metadata?.parts || [];
        const mergedParts = [...existingParts, ...streamingAssistantParts];

        msgs[msgs.length - 1] = {
          ...lastMsg,
          metadata: {
            ...lastMsg.metadata,
            isStreaming: true,
            parts: mergedParts,
          },
        };
      } else {
        // No existing assistant message, create new streaming one
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
    }

    return msgs;
  }, [messages, streamingAssistantParts, isStreaming, mostRecentMessageModel]);

  return (
    <div className="relative z-0 mx-auto flex w-full max-w-lg grow flex-col items-center px-4 sm:px-6">
      <Messages
        taskId={taskId}
        messages={displayMessages}
        disableEditing={status === "ARCHIVED" || status === "INITIALIZING"}
      />

      {status !== "ARCHIVED" && (
        <>
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
        </>
      )}
    </div>
  );
}
