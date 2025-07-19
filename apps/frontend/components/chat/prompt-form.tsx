"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { createTask } from "@/lib/actions/create-task";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import {
  AvailableModels,
  ModelInfos,
  type ModelInfo,
  type ModelType,
} from "@repo/types";
import { ArrowUp, Layers, Loader2, Square } from "lucide-react";
import { redirect } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { GithubConnection } from "./github";

export function PromptForm({
  onSubmit,
  isStreaming = false,
  isHome = false,
}: {
  onSubmit?: (message: string, model: ModelType) => void;
  isStreaming?: boolean;
  isHome?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelType>(
    AvailableModels.GPT_4O
  );
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // TODO: initial fetch on server and use useQuery
  useEffect(() => {
    async function fetchModels() {
      try {
        const baseUrl =
          process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";
        const res = await fetch(`${baseUrl}/api/models`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { models: ModelInfo[] };
        setAvailableModels(data.models);
      } catch (err) {
        console.error("Failed to fetch available models", err);
      }
    }

    fetchModels();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isStreaming || !selectedModel) return;

    if (isHome) {
      // Require repo and branch selection before creating a task
      if (!repoUrl || !branch) {
        toast.error("Select a repository and branch first");
        return;
      }

      const formData = new FormData();
      formData.append("message", message);
      formData.append("model", selectedModel);
      formData.append("repoUrl", repoUrl);
      formData.append("branch", branch);

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
        "flex w-full flex-col max-w-lg bg-background z-0 relative",
        !isHome && "sticky bottom-0 pb-6"
      )}
    >
      {/* Wrapper div with textarea styling */}
      <div
        className={cn(
          "border-border relative focus-within:ring-ring/10 from-input/25 to-input flex min-h-24 w-full flex-col rounded-lg border bg-transparent bg-gradient-to-t shadow-xs transition-[color,box-shadow,border] focus-within:ring-4 focus-within:border-sidebar-border",
          isPending && "opacity-50"
        )}
      >
        {!isHome && (
          <div className="absolute -left-px w-[calc(100%+2px)] -top-16 h-16 bg-gradient-to-t from-background via-background/60 to-transparent -translate-y-px pointer-events-none -z-10" />
        )}

        {/* Textarea without border/background since wrapper handles it */}
        <Textarea
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Build a cool new feature..."
          className="max-h-48 flex-1 resize-none rounded-lg border-0 bg-transparent! shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
        />

        {/* Buttons inside the container */}
        <div className="flex items-center justify-between p-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:bg-accent font-normal"
              >
                <Layers className="size-4" />
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
                onSelect={(repo, br) => {
                  setRepoUrl(repo);
                  setBranch(br);
                }}
              />
            )}
            <Button
              type="submit"
              size="iconSm"
              disabled={
                isStreaming ||
                isPending ||
                !message.trim() ||
                !selectedModel ||
                (isHome && (!repoUrl || !branch))
              }
              className="focus-visible:ring-primary focus-visible:ring-offset-input rounded-full focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
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
