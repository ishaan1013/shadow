import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./messages.css";
import { cn } from "@/lib/utils";
import { Textarea } from "../ui/textarea";
import { ArrowUp, Loader2, X } from "lucide-react";
import { Button } from "../ui/button";
import { ModelSelector } from "./model-selector";
import { AvailableModels, Message, ModelType } from "@repo/types";
import { useEditMessageId } from "@/hooks/use-edit-message-id";
import { useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useEditMessage } from "@/hooks/use-edit-message";
import { type StreamingStatusSetter } from "@/lib/constants";

const MAX_CONTENT_HEIGHT = 128;

export function UserMessage({
  taskId,
  message,
  className,
  isFirstMessage,
  disableEditing,
  userMessageWrapperRef,
  setStreamingStatus,
}: {
  taskId: string;
  message: Message;
  isFirstMessage: boolean;
  className?: string;
  disableEditing: boolean;
  userMessageWrapperRef: React.RefObject<HTMLButtonElement | null>;
  setStreamingStatus?: StreamingStatusSetter;
}) {
  const queryClient = useQueryClient();
  const { data: editMessageId } = useEditMessageId(taskId);
  const editMessageMutation = useEditMessage(setStreamingStatus);
  const isEditing = useMemo(
    () => editMessageId === message.id,
    [editMessageId, message.id]
  );

  const initialModel = useMemo(() => {
    if (message.llmModel) {
      return message.llmModel as ModelType;
    }
    return AvailableModels.GPT_4O;
  }, [message.llmModel]);

  const [editValue, setEditValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedModel, setSelectedModel] = useState<ModelType>(initialModel);
  const messageContentRef = useRef<HTMLDivElement>(null);
  const [isContentOverflowing, setIsContentOverflowing] = useState(false);

  useEffect(() => {
    if (messageContentRef.current) {
      setIsContentOverflowing(
        messageContentRef.current.scrollHeight > MAX_CONTENT_HEIGHT
      );
    }
  }, [message.content]);

  const handleSelectModel = useCallback((model: ModelType | null) => {
    if (model) {
      setSelectedModel(model);
    }
  }, []);

  const handleStartEditing = () => {
    if (!isEditing && !disableEditing) {
      queryClient.setQueryData(["edit-message-id", taskId], message.id);
      setEditValue(message.content);
    }
  };

  const handleStopEditing = () => {
    if (isEditing) {
      queryClient.setQueryData(["edit-message-id", taskId], null);
    }
  };

  const handleSubmit = useCallback(() => {
    if (!editValue.trim()) {
      handleStopEditing();
      return;
    }

    editMessageMutation.mutate({
      taskId,
      messageId: message.id,
      newContent: editValue.trim(),
      newModel: selectedModel,
    });
  }, [
    editValue,
    message.content,
    message.id,
    selectedModel,
    taskId,
    editMessageMutation,
    handleStopEditing,
  ]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        handleSubmit();
      }
    },
    [handleSubmit]
  );

  useEffect(() => {
    const globalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleStopEditing();
      }
    };
    window.addEventListener("keydown", globalKeyDown);
    return () => window.removeEventListener("keydown", globalKeyDown);
  }, [handleStopEditing]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const textarea = textareaRef.current;
      // Set cursor position to end of text
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
      // Scroll to bottom of textarea
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [isEditing]);

  return (
    // Outer button acts as a border, with a border-radius 1px larger than the inner div and 1px padding
    <UserMessageWrapper
      userMessageWrapperRef={userMessageWrapperRef}
      isEditing={isEditing}
      handleStartEditing={handleStartEditing}
      isFirstMessage={isFirstMessage}
      className={className}
      disableEditing={disableEditing}
    >
      {isEditing ? (
        <>
          <div className="select-none overflow-clip">
            <div className="flex flex-col gap-0.5 p-1.5">
              <div className="text-muted-foreground flex w-full items-center justify-between gap-1 pl-1.5 text-xs font-medium">
                <span>Editing Message</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconXs"
                      tabIndex={-1}
                      className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border p-0"
                      onClick={handleStopEditing}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="end"
                    shortcut="esc"
                    sideOffset={10}
                  >
                    Cancel Editing
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
          <div className="from-card/10 to-card relative flex min-h-24 flex-col rounded-lg bg-gradient-to-t">
            <div className="bg-background absolute inset-0 -z-10 rounded-[calc(var(--radius)+1px)]" />
            <Textarea
              ref={textareaRef}
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder="Build a cool new feature..."
              className="placeholder:text-muted-foreground/50 bg-transparent! max-h-48 flex-1 resize-none border-0 text-sm shadow-none focus-visible:ring-0"
              onKeyDown={onKeyDown}
            />

            <div
              className="flex items-center justify-between p-2"
              onClick={() => textareaRef.current?.focus()}
            >
              <ModelSelector
                selectedModel={selectedModel}
                handleSelectModel={handleSelectModel}
              />

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSubmit}
                  size="iconSm"
                  disabled={
                    !editValue.trim() ||
                    editMessageMutation.isPending ||
                    !selectedModel
                  }
                  className="focus-visible:ring-primary focus-visible:ring-offset-input rounded-full focus-visible:ring-2 focus-visible:ring-offset-2"
                >
                  {editMessageMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            className="from-card/10 to-card relative z-0 w-full overflow-clip rounded-lg bg-gradient-to-t px-3 py-2 text-sm"
            style={{
              maxHeight: `${MAX_CONTENT_HEIGHT}px`,
            }}
          >
            {isContentOverflowing && (
              <div className="from-background via-background/80 to-card/0 animate-in fade-in absolute bottom-0 left-0 h-1/3 w-full bg-gradient-to-t" />
            )}
            <div className="whitespace-pre-wrap" ref={messageContentRef}>
              {message.content}
            </div>
          </div>
          <div className="bg-background absolute inset-px -z-10 rounded-[calc(var(--radius)+1px)]" />
        </>
      )}
    </UserMessageWrapper>
  );
}

function UserMessageWrapper({
  children,
  isEditing,
  isFirstMessage,
  className,
  handleStartEditing,
  userMessageWrapperRef,
  disableEditing,
}: {
  children: React.ReactNode;
  isEditing: boolean;
  isFirstMessage: boolean;
  className?: string;
  handleStartEditing: () => void;
  userMessageWrapperRef: React.RefObject<HTMLButtonElement | null>;
  disableEditing: boolean;
}) {
  if (isEditing) {
    return (
      <div
        className={cn(
          "sticky top-16 z-10 w-full rounded-[calc(var(--radius)+1px)] p-px transition-all",
          "focus-visible:ring-ring/10 focus-visible:outline-none focus-visible:ring-4",
          "user-message-border user-message-shadow",
          className
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <button
      ref={userMessageWrapperRef}
      onClick={handleStartEditing}
      className={cn(
        "sticky top-16 z-10 w-full rounded-[calc(var(--radius)+1px)] p-px text-left transition-all",
        "focus-visible:ring-ring/10 focus-visible:outline-none focus-visible:ring-4",
        "user-message-border user-message-shadow",
        !isFirstMessage && "mt-9",
        !disableEditing && "cursor-pointer",
        className
      )}
    >
      {children}
    </button>
  );
}
