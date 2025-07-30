"use client";

import "./prompt-form.css";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useModels } from "@/hooks/use-models";
import { useApiKeys } from "@/hooks/use-api-keys";
import { createTask } from "@/lib/actions/create-task";
import { cn } from "@/lib/utils";
import { AvailableModels, ModelInfos, type ModelType, getModelProvider } from "@repo/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  GitBranchPlus,
  Layers,
  ListEnd,
  Loader2,
  MessageCircle,
  MessageCircleX,
  Square,
  X,
} from "lucide-react";
import { redirect } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { GithubConnection } from "./github";
import type { FilteredRepository as Repository } from "@/lib/github/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useQueuedMessage } from "@/hooks/use-queued-message";
import { UserMessage } from "./user-message";
import { useTaskSocket } from "@/hooks/socket/use-task-socket";

export function PromptForm({
  taskId,
  onSubmit,
  onStopStream,
  isStreaming = false,
  isHome = false,
  onFocus,
  onBlur,
  initialGitCookieState,
}: {
  taskId: string;
  onSubmit?: (message: string, model: ModelType, queue: boolean) => void;
  onStopStream?: () => void;
  isStreaming?: boolean;
  isHome?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  initialGitCookieState?: {
    repo: Repository | null;
    branch: { name: string; commitSha: string } | null;
  } | null;
}) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedModel, setSelectedModel] = useState<ModelType>(
    AvailableModels.GPT_4O
  );
  const [repo, setRepo] = useState<Repository | null>(
    initialGitCookieState?.repo || null
  );
  const [branch, setBranch] = useState<{
    name: string;
    commitSha: string;
  } | null>(initialGitCookieState?.branch || null);

  const [isPending, startTransition] = useTransition();
  const { clearQueuedMessage } = useTaskSocket(taskId);
  const { data: queuedMessage } = useQueuedMessage(taskId);

  const queryClient = useQueryClient();
  const { data: availableModels = [] } = useModels();
  const { data: apiKeys } = useApiKeys();

  // Filter models based on available API keys
  const filteredModels = availableModels.filter((model) => {
    const provider = getModelProvider(model.id as ModelType);
    if (provider === "openai") {
      return !!(apiKeys?.openai);
    }
    if (provider === "anthropic") {
      return !!(apiKeys?.anthropic);
    }
    return true;
  });

  // Check if no API keys are configured
  const hasNoApiKeys = !apiKeys?.openai && !apiKeys?.anthropic;

  const [isMessageOptionsOpen, setIsMessageOptionsOpen] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isGithubConnectionOpen, setIsGithubConnectionOpen] = useState(false);

  const messageOptions = isStreaming
    ? [
        {
          id: "queue",
          icon: ListEnd,
          label: "Queue Message",
          action: () => {
            console.log("queue");
            onSubmit?.(message, selectedModel, true);
            queryClient.setQueryData(["queued-message", taskId], message);
            setMessage("");
          },
          shortcut: {
            key: "Enter",
            meta: false,
            ctrl: false,
            alt: false,
            shift: false,
          },
        },
        {
          id: "send",
          icon: MessageCircleX,
          label: "Stop & Send",
          action: () => {
            console.log("send");
            onSubmit?.(message, selectedModel, false);
            setMessage("");
          },
          shortcut: {
            key: "Enter",
            meta: true,
            ctrl: false,
            alt: false,
            shift: false,
          },
        },
        {
          id: "stack-pr",
          icon: GitBranchPlus,
          label: "Queue Stacked PR",
          action: () => {
            console.log("stack-pr (NOT IMPLEMENTED)");
            onSubmit?.(message, selectedModel, true);
            setMessage("");
          },
          shortcut: {
            key: "Enter",
            meta: false,
            ctrl: false,
            alt: true,
            shift: false,
          },
        },
      ]
    : [
        {
          id: "send",
          icon: MessageCircle,
          label: "Send Message",
          action: () => {
            console.log("send");
            onSubmit?.(message, selectedModel, false);
            setMessage("");
          },
          shortcut: {
            key: "Enter",
            meta: false,
            ctrl: false,
            alt: false,
            shift: false,
          },
        },
        {
          id: "stack-pr",
          icon: GitBranchPlus,
          label: "Create Stacked PR",
          action: () => {
            console.log("stack-pr (NOT IMPLEMENTED)");
            onSubmit?.(message, selectedModel, false);
            setMessage("");
          },
          shortcut: {
            key: "Enter",
            meta: false,
            ctrl: false,
            alt: true,
            shift: false,
          },
        },
      ];

  const formatShortcut = (shortcut: {
    key: string;
    meta: boolean;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
  }) => {
    const modifiers = [];
    if (shortcut.meta) modifiers.push("⌘");
    if (shortcut.ctrl) modifiers.push("⌃");
    if (shortcut.alt) modifiers.push("⌥");
    if (shortcut.shift) modifiers.push("⇧");

    const keyDisplay = shortcut.key === "Enter" ? "⏎" : shortcut.key;
    return modifiers.length > 0
      ? `${modifiers.join("")}${keyDisplay}`
      : keyDisplay;
  };

  // Submission handling for home page
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModel || !isHome || !repo || !branch || !message.trim()) {
      return;
    }

    const completeRepoUrl = `https://github.com/${repo.full_name}`;

    const formData = new FormData();
    formData.append("message", message);
    formData.append("model", selectedModel);
    formData.append("repoUrl", completeRepoUrl);
    formData.append("repoFullName", repo.full_name);
    formData.append("baseBranch", branch.name);
    formData.append("baseCommitSha", branch.commitSha);

    startTransition(async () => {
      let taskId: string | null = null;
      try {
        taskId = await createTask(formData);
      } catch (error) {
        toast.error("Failed to create task", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
      if (taskId) {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        redirect(`/tasks/${taskId}`);
      }
    });
  };

  // onKeyDown handler for home page
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && isHome) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Keyboard shortcuts, including submission handling for task page
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when not on home page
      if (isHome) return;

      if (event.key === "." && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setIsModelSelectorOpen((prev) => !prev);
      }

      if (
        (event.key === "Escape" ||
          event.key === "Delete" ||
          event.key === "Backspace") &&
        isMessageOptionsOpen
      ) {
        event.preventDefault();
        setIsMessageOptionsOpen(false);
      }

      // Keyboard shortcuts when message options are open
      if (isMessageOptionsOpen) {
        for (const option of messageOptions) {
          const shortcut = option.shortcut;

          // Check if the key and all modifiers match
          if (
            event.key === shortcut.key &&
            (shortcut.meta ? event.metaKey : !event.metaKey) &&
            (shortcut.ctrl ? event.ctrlKey : !event.ctrlKey) &&
            (shortcut.alt ? event.altKey : !event.altKey) &&
            (shortcut.shift ? event.shiftKey : !event.shiftKey)
          ) {
            event.preventDefault();
            option.action();
            setIsMessageOptionsOpen(false);
            // TODO: Handle option-specific logic
            break;
          }
        }
      } else {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          setIsMessageOptionsOpen(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          if (isStreaming) {
            onStopStream?.();
          }
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isHome, isMessageOptionsOpen, messageOptions, isStreaming]);

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "bg-background relative z-0 flex w-full max-w-lg flex-col",
        !isHome && "sticky bottom-0 pb-6"
      )}
    >
      {!isHome && (
        <div className="from-background via-background/60 pointer-events-none absolute -left-px -top-[calc(4rem-1px)] -z-10 h-16 w-[calc(100%+2px)] -translate-y-px bg-gradient-to-t to-transparent" />
      )}

      {queuedMessage && (
        <div className="bg-card border-border absolute -top-12 left-0 flex w-full items-center justify-between gap-2 rounded-lg border py-1.5 pl-3 pr-1.5 text-sm">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <ListEnd className="size-4" />
            <span className="select-none">Queued</span>
            <span className="text-muted-foreground truncate">
              {queuedMessage}
            </span>
          </div>
          <Button
            variant="ghost"
            size="iconXs"
            className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border p-0"
            onClick={() => {
              queryClient.setQueryData(["queued-message", taskId], null);
              clearQueuedMessage();
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Wrapper div with textarea styling */}
      {/* Outer div acts as a border, with a border-radius 1px larger than the inner div and 1px padding */}
      <div
        className={cn(
          "shadow-highlight/10 relative z-0 rounded-[calc(var(--radius)+1px)] p-px shadow-lg transition-all",
          "focus-within:ring-ring/10 focus-within:border-sidebar-border focus-within:ring-4",
          "prompt-form-border hover:shadow-highlight/20 focus-within:shadow-highlight/20",
          isPending && "opacity-50"
        )}
      >
        {!isHome && (
          <div
            className={cn(
              "ease-out-expo overflow-clip transition-all duration-500",
              isMessageOptionsOpen
                ? isStreaming
                  ? "h-[126px]"
                  : "h-[96px]"
                : "h-0"
            )}
          >
            <div className="flex flex-col gap-0.5 p-1.5">
              <div className="text-muted-foreground flex w-full items-center justify-between gap-1 pl-1.5 text-xs font-medium">
                <span>Select Message Option</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconXs"
                      tabIndex={-1}
                      className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border p-0"
                      onClick={() => setIsMessageOptionsOpen(false)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end" shortcut="esc">
                    Cancel
                  </TooltipContent>
                </Tooltip>
              </div>
              {messageOptions.map((option) => {
                const IconComponent = option.icon;
                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    tabIndex={-1}
                    onClick={() => {
                      option.action();
                      setIsMessageOptionsOpen(false);
                    }}
                    className="hover:bg-sidebar-border justify-between font-normal"
                  >
                    <div className="flex items-center gap-1.5">
                      <IconComponent className="size-4" />
                      <span>{option.label}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {formatShortcut(option.shortcut)}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <div className="from-input/25 to-input relative flex min-h-24 flex-col rounded-lg bg-gradient-to-t">
          <div className="bg-background absolute inset-0 -z-20 rounded-[calc(var(--radius)+1px)]" />
          <Textarea
            ref={textareaRef}
            autoFocus
            value={message}
            onChange={(e) => {
              if (!isMessageOptionsOpen) {
                setMessage(e.target.value);
              }
            }}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder="Build a cool new feature..."
            className="placeholder:text-muted-foreground/50 bg-transparent! max-h-48 flex-1 resize-none border-0 shadow-none focus-visible:ring-0"
          />

          {/* Buttons inside the container */}
          <div
            className="group/footer flex items-center justify-between p-2"
            onClick={() => textareaRef.current?.focus()}
          >
            <Popover
              open={isModelSelectorOpen}
              onOpenChange={setIsModelSelectorOpen}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:bg-accent px-2 font-normal"
                    >
                      {isHome && <Layers className="size-4" />}
                      <span>
                        {selectedModel
                          ? ModelInfos[selectedModel].name
                          : "Select model"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                {!isModelSelectorOpen && (
                  <TooltipContent side="top" align="start" shortcut="⌘.">
                    Model Selector
                  </TooltipContent>
                )}
              </Tooltip>
              <PopoverContent
                align="start"
                className="flex flex-col gap-0.5 rounded-lg p-1"
              >
                {filteredModels.length > 0 ? (
                  filteredModels.map((model) => (
                    <Button
                      key={model.id}
                      size="sm"
                      variant="ghost"
                      className="hover:bg-accent justify-start font-normal"
                      onClick={() => setSelectedModel(model.id as ModelType)}
                    >
                      <Square className="size-4" />
                      {model.name}
                    </Button>
                  ))
                ) : (
                  <div className="p-2 text-center">
                    <p className="text-muted-foreground text-sm mb-2">
                      No models available. Configure your API keys to access models.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => {
                        setIsModelSelectorOpen(false);
                        // Open settings modal to models tab
                        const event = new CustomEvent('open-settings-modal', { 
                          detail: { tab: 'models' } 
                        });
                        window.dispatchEvent(event);
                      }}
                    >
                      Configure API Keys
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            <div className="flex items-center gap-2">
              {isHome && (
                <GithubConnection
                  isOpen={isGithubConnectionOpen}
                  setIsOpen={setIsGithubConnectionOpen}
                  selectedRepo={repo}
                  selectedBranch={branch}
                  setSelectedRepo={setRepo}
                  setSelectedBranch={setBranch}
                />
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  size="iconSm"
                  disabled={
                    (!isStreaming && !message.trim()) ||
                    isMessageOptionsOpen ||
                    isPending ||
                    !selectedModel ||
                    (isHome && (!repo || !branch))
                  }
                  className="focus-visible:ring-primary focus-visible:ring-offset-input rounded-full focus-visible:ring-2 focus-visible:ring-offset-2"
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isStreaming && !message.trim() ? (
                    <div className="p-0.5">
                      <Square className="fill-primary-foreground size-3" />
                    </div>
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
