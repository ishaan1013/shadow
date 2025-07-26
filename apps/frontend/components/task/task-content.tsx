"use client";

import { Messages } from "@/components/chat/messages";
import { PromptForm } from "@/components/chat/prompt-form";
import { ScrollToBottom } from "@/hooks/use-is-at-top";
import { useSendMessage } from "@/hooks/use-send-message";
import { useTaskMessages } from "@/hooks/use-task-messages";
import { useTaskSocket } from "@/hooks/socket";
import { cn } from "@/lib/utils";
import { useParams } from "next/navigation";
import { StickToBottom } from "use-stick-to-bottom";
import { Loader2, Database, Brain, FileCode } from "lucide-react";

export function TaskPageContent({ isAtTop }: { isAtTop: boolean }) {
  const { taskId } = useParams<{ taskId: string }>();

  const { data: messages = [], error: taskMessagesError } =
    useTaskMessages(taskId);
  const sendMessageMutation = useSendMessage();

  // Replace all socket logic with one hook call
  const {
    isConnected,
    streamingAssistantParts,
    isStreaming,
    indexingState,
    sendMessage,
    stopStream,
  } = useTaskSocket(taskId);

  const handleSendMessage = (message: string, model: string) => {
    if (!taskId || !message.trim()) return;

    // Use the mutation for optimistic updates
    sendMessageMutation.mutate({ taskId, message, model });

    // Send via socket
    sendMessage(message, model);
  };

  const handleStopStream = () => {
    stopStream();
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
          "from-background via-background/60 pointer-events-none sticky -left-px top-0 z-10 h-16 w-[calc(100%+2px)] -translate-y-px bg-gradient-to-b to-transparent transition-opacity",
          isAtTop ? "opacity-0" : "opacity-100"
        )}
      />

      <div className="relative w-full">
        <Messages messages={displayMessages} />
        
        {/* Repository indexing overlay */}
        {indexingState?.isIndexing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <div className="bg-card border rounded-lg shadow-lg p-6 max-w-md text-center">
              <h3 className="text-xl font-semibold mb-4">Understanding your repository</h3>
              <div className="flex flex-col items-center justify-center space-y-6 mb-6">
                {indexingState.phase === "preparing" && (
                  <div className="flex items-center space-x-3">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span>Preparing files...</span>
                  </div>
                )}
                {indexingState.phase === "embeddings" && (
                  <div className="flex items-center space-x-3">
                    <Database className="h-6 w-6 text-blue-600" />
                    <span>Indexing code embeddings...</span>
                  </div>
                )}
                {indexingState.phase === "understanding" && (
                  <div className="flex items-center space-x-3">
                    <Brain className="h-6 w-6 text-green-600" />
                    <span>Analyzing repository structure...</span>
                  </div>
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                This helps me provide more accurate and context-aware responses for your codebase.
              </p>
            </div>
          </div>
        )}
      </div>

      <ScrollToBottom />

      <PromptForm
        onSubmit={handleSendMessage}
        onStopStream={handleStopStream}
        isStreaming={isStreaming || sendMessageMutation.isPending}
        isIndexing={indexingState?.isIndexing || false}
      />
    </StickToBottom.Content>
  );
}
