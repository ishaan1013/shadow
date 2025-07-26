"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useModels } from "@/hooks/use-models";
import { createTask } from "@/lib/actions/create-task";
import { cn } from "@/lib/utils";
import { AvailableModels, ModelInfos, type ModelType } from "@repo/types";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Layers, Loader2, Square } from "lucide-react";
import { redirect } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { GithubConnection } from "./github";
import type { FilteredRepository as Repository } from "@/lib/github/types";

export function PromptForm({
  onSubmit,
  onStopStream,
  isStreaming = false,
  isHome = false,
  onFocus,
  onBlur,
}: {
  onSubmit?: (message: string, model: ModelType) => void;
  onStopStream?: () => void;
  isStreaming?: boolean;
  isHome?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [message, setMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelType>(
    AvailableModels.GPT_4O
  );
  const [repo, setRepo] = useState<Repository | null>(null);
  const [branch, setBranch] = useState<{
    name: string;
    commitSha: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const queryClient = useQueryClient();
  const { data: availableModels = [] } = useModels();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isStreaming || !selectedModel) return;

    if (isHome) {
      // Require repo and branch selection before creating a task
      if (!repo || !branch) {
        toast.error("Select a repository and branch first");
        return;
      }

      const completeRepoUrl = `https://github.com/${repo.full_name}`;

      const formData = new FormData();
      formData.append("message", message);
      formData.append("model", selectedModel);
      formData.append("repoUrl", completeRepoUrl);
      formData.append("baseBranch", branch.name);
      formData.append("baseCommitSha", branch.commitSha);

      startTransition(async () => {
        let taskId: string | null = null;
        try {
          taskId = await createTask(formData);
        } catch (error) {
          toast.error("Failed to create task", {
            description:
              error instanceof Error ? error.message : "Unknown error",
          });
        }
        if (taskId) {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          redirect(`/tasks/${taskId}`);
        }
      });
    } else {
      onSubmit?.(message, selectedModel);
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "bg-background relative z-0 flex w-full max-w-lg flex-col",
        !isHome && "sticky bottom-0 pb-6"
      )}
    >
      {/* Wrapper div with textarea styling */}
      <div
        className={cn(
          "border-border focus-within:ring-ring/10 from-input/25 to-input focus-within:border-sidebar-border shadow-xs relative flex min-h-24 w-full flex-col rounded-lg border bg-transparent bg-gradient-to-t transition-[color,box-shadow,border] focus-within:ring-4",
          isPending && "opacity-50"
        )}
      >
        {!isHome && (
          <div className="from-background via-background/60 pointer-events-none absolute -left-px -top-16 -z-10 h-16 w-[calc(100%+2px)] -translate-y-px bg-gradient-to-t to-transparent" />
        )}

        {/* Textarea without border/background since wrapper handles it */}
        <Textarea
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Build a cool new feature..."
          className="placeholder:text-muted-foreground/50 bg-transparent! max-h-48 flex-1 resize-none rounded-lg border-0 shadow-none focus-visible:ring-0"
        />

        {/* Buttons inside the container */}
        <div className="flex items-center justify-between p-2">
          <Popover>
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
            <PopoverContent
              align="start"
              className="flex flex-col gap-0.5 rounded-lg p-1"
            >
              {availableModels.map((model) => (
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
              ))}
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2">
            {isHome && (
              <GithubConnection
                selectedRepo={repo}
                selectedBranch={branch}
                setSelectedRepo={setRepo}
                setSelectedBranch={setBranch}
              />
            )}
            <Button
              type={isStreaming ? "button" : "submit"}
              size="iconSm"
              disabled={
                !isStreaming &&
                (isPending ||
                  !message.trim() ||
                  !selectedModel ||
                  (isHome && (!repo || !branch)))
              }
              onClick={isStreaming ? onStopStream : undefined}
              className="focus-visible:ring-primary focus-visible:ring-offset-input rounded-full focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isStreaming ? (
                <Square className="fill-primary-foreground size-3.5" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
