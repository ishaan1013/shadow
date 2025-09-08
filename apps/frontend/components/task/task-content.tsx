"use client";

import { Messages } from "@/components/chat/messages/messages";
import { PromptForm } from "@/components/chat/prompt-form/prompt-form";
import { useSendMessage } from "@/hooks/chat/use-send-message";
import { useTaskMessages } from "@/hooks/tasks/use-task-messages";
import { useTaskSocketContext } from "@/contexts/task-socket-context";
import { useParams } from "next/navigation";
import { ScrollToBottom } from "./scroll-to-bottom";
import { useCallback, useMemo, memo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ModelType } from "@repo/types";
import {
  deduplicatePartsFromMap,
  convertMapToPartsArray,
} from "@/lib/streaming";
import { useTask } from "@/hooks/tasks/use-task";

function TaskPageContent() {
  const queryClient = useQueryClient();

  const { taskId } = useParams<{ taskId: string }>();
  const { task } = useTask(taskId);

  const { data: messages = [], error: taskMessagesError } =
    useTaskMessages(taskId);

  const sendMessageMutation = useSendMessage();

  const [visibleChats, setVisibleChats] = useState<Set<string>>(new Set());
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "g") {
        e.preventDefault();
        setIsCollapsed((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  const {
    streamingPartsMap,
    streamingPartsOrder,
    isStreaming,
    isCompletionPending,
    sendMessage,
    stopStream,
    createStackedPR,
  } = useTaskSocketContext();

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

    // Only proceed if we have streaming parts, are actively streaming, or completion is pending
    if (streamingPartsMap.size === 0 && !isStreaming && !isCompletionPending) {
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
        llmModel: task?.mainModel || "",
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
    isCompletionPending,
    task?.mainModel,
  ]);

  return (
    <div className="relative z-0 mx-auto flex w-full max-w-xl grow flex-col items-center px-4 sm:px-6">
      <Messages
        taskId={taskId}
        messages={displayMessages}
        disableEditing={
          task?.status === "ARCHIVED" || task?.status === "INITIALIZING"
        }
        isStreamPending={
          task?.status === "RUNNING" && streamingPartsMap.size === 0
        }
        isStreaming={isStreaming}
        isReInitializing={
          task?.status === "INITIALIZING" && task?.hasBeenInitialized
        }
      />

      {task?.status !== "ARCHIVED" && (
        <>
          <ScrollToBottom />

          <PromptForm
            onSubmit={handleSendMessage}
            onCreateStackedPR={handleCreateStackedPR}
            onStopStream={handleStopStream}
            isStreaming={isStreaming || sendMessageMutation.isPending}
            initialSelectedModel={task?.mainModel as ModelType | null}
            onFocus={() => {
              queryClient.setQueryData(["edit-message-id", taskId], null);
            }}
            isInitializing={task?.status === "INITIALIZING"}
            collapsedState={{
              id: "variant1",
              collapsed: isCollapsed,
              hide: (id: string) => {
                setVisibleChats((prev) => {
                  const newSet = new Set(prev);
                  newSet.delete(id);
                  return newSet;
                });
              },
              focus: (id: string) => {
                // setVisibleChats(new Set([id]));
                setIsCollapsed(false);
              },
            }}
          />
        </>
      )}
    </div>
  );
}

export const MemoizedTaskPageContent = memo(TaskPageContent);
