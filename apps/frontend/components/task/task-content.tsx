"use client";

import { Messages } from "@/components/chat/messages";
import { PromptForm } from "@/components/chat/prompt-form";
import { useSendMessage } from "@/hooks/use-send-message";
import { useTaskMessages } from "@/hooks/use-task-messages";
import { useTaskSocket } from "@/hooks/socket";
import { useParams } from "next/navigation";
import { ScrollToBottom } from "./scroll-to-bottom";
import { useCallback, useMemo, memo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ModelType } from "@repo/types";
import { useTaskStatus } from "@/hooks/use-task-status";
import {
  deduplicatePartsFromMap,
  convertMapToPartsArray,
} from "@/lib/streaming";

function TaskPageContent() {
  const { taskId } = useParams<{ taskId: string }>();

  const queryClient = useQueryClient();

  const { data } = useTaskStatus(taskId);
  const status = data?.status;

  // Thinking state management
  const [thinkingEnabled, setThinkingEnabled] = useState(false);

  const {
    data: { messages = [], mostRecentMessageModel = null } = {},
    error: taskMessagesError,
  } = useTaskMessages(taskId);

  const sendMessageMutation = useSendMessage();

  const {
    streamingPartsMap,
    streamingPartsOrder,
    isStreaming,
    sendMessage,
    stopStream,
    createStackedPR,
  } = useTaskSocket(taskId);

  const handleSendMessage = useCallback(
    (message: string, model: ModelType, queue: boolean) => {
      if (!taskId || !message.trim()) return;

      // Use the mutation for optimistic updates
      if (!queue) {
        sendMessageMutation.mutate({ taskId, message, model });
      }

      // Send via socket with thinking configuration
      const thinkingConfig = thinkingEnabled
        ? { enabled: true, budgetTokens: 10000 }
        : { enabled: false };
      sendMessage(message, model, queue, thinkingConfig);
    },
    [taskId, sendMessageMutation, sendMessage, thinkingEnabled]
  );

  const handleStopStream = useCallback(() => {
    stopStream();
  }, [stopStream]);

  const handleCreateStackedPR = useCallback(
    (message: string, model: ModelType, queue: boolean) => {
      if (!taskId || !message.trim()) return;

      createStackedPR(message, model, queue);
    },
    [taskId, createStackedPR]
  );

  if (taskMessagesError) {
    return (
      <div className="mx-auto flex w-full max-w-xl grow flex-col items-center justify-center">
        <div className="text-destructive">
          Error fetching messages: {taskMessagesError.message}
        </div>
      </div>
    );
  }

  // Combine real messages with current streaming content using modern Map-based deduplication
  const displayMessages = useMemo(() => {
    const msgs = [...messages];

    // Only proceed if we have streaming parts or are actively streaming
    if (streamingPartsMap.size === 0 && !isStreaming) {
      return msgs;
    }

    // Find the last streaming assistant message (not tool message)
    let lastStreamingIndex = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (
        msg &&
        msg.role.toLowerCase() === "assistant" &&
        msg.metadata?.isStreaming === true
      ) {
        lastStreamingIndex = i;
        break;
      }
    }

    if (lastStreamingIndex !== -1) {
      // Merge with existing streaming assistant message using modern Map-based deduplication
      const existingMsg = msgs[lastStreamingIndex];
      if (existingMsg) {
        const existingParts = existingMsg.metadata?.parts || [];
        const mergedParts = deduplicatePartsFromMap(
          existingParts,
          streamingPartsMap,
          streamingPartsOrder
        );

        msgs[lastStreamingIndex] = {
          ...existingMsg,
          metadata: {
            ...existingMsg.metadata,
            isStreaming: true,
            parts: mergedParts,
          },
        };
      }
    } else if (streamingPartsOrder.length > 0) {
      // Create new streaming assistant message from Map data
      const streamingParts = convertMapToPartsArray(
        streamingPartsMap,
        streamingPartsOrder
      );

      msgs.push({
        id: "streaming",
        role: "assistant",
        content: "", // Content will come from parts
        createdAt: new Date().toISOString(),
        llmModel: mostRecentMessageModel || "",
        metadata: {
          isStreaming: true,
          parts: streamingParts,
        },
      });
    }

    return msgs;
  }, [
    messages,
    streamingPartsMap,
    streamingPartsOrder,
    isStreaming,
    mostRecentMessageModel,
  ]);

  return (
    <div className="relative z-0 mx-auto flex w-full max-w-xl grow flex-col items-center px-4 sm:px-6">
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
            onCreateStackedPR={handleCreateStackedPR}
            onStopStream={handleStopStream}
            isStreaming={isStreaming || sendMessageMutation.isPending}
            initialSelectedModel={mostRecentMessageModel}
            onFocus={() => {
              queryClient.setQueryData(["edit-message-id", taskId], null);
            }}
            isInitializing={status === "INITIALIZING"}
            thinkingEnabled={thinkingEnabled}
            onThinkingToggle={setThinkingEnabled}
          />
        </>
      )}
    </div>
  );
}

export const MemoizedTaskPageContent = memo(TaskPageContent);
