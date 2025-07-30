"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  FolderOpen,
  Code,
  FolderGit2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { MarkdownRenderer } from "@/components/agent-environment/markdown-renderer";
import { useParams } from "next/navigation";
import { useCodebase } from "@/hooks/use-codebase";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

export function CodebasePageContent() {
  const { codebaseId } = useParams<{ codebaseId: string }>();
  const [isGenerating, setIsGenerating] = useState(false);

  const { open } = useSidebar();

  const { data: codebase, isLoading, error, refetch } = useCodebase(codebaseId);
  const summaries = useMemo(() => codebase?.summaries || [], [codebase]);

  const generateSummary = async () => {
    if (!codebase?.tasks?.[0]?.id) return;

    setIsGenerating(true);
    try {
      const response = await fetch(
        `/api/indexing/shallowwiki/generate/${codebase.tasks[0].id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forceRefresh: true }),
        }
      );

      if (response.ok) {
        await refetch();
      }
    } catch (error) {
      console.error("Failed to generate summary:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Organize summaries by type
  const { repoSummaries, fileSummaries, directorySummaries } = useMemo(() => {
    const repoSummaries = summaries.filter((s) => s.type === "repo_summary");
    const fileSummaries = summaries.filter((s) => s.type === "file_summary");
    const directorySummaries = summaries.filter(
      (s) => s.type === "directory_summary"
    );
    return { repoSummaries, fileSummaries, directorySummaries };
  }, [summaries]);

  // Find the main overview
  const overview =
    repoSummaries.find(
      (s) =>
        s.filePath === "root_overview" ||
        (s.filePath?.toLowerCase().includes("root") &&
          s.filePath?.toLowerCase().includes("overview"))
    ) || repoSummaries[0];

  const getLanguageBadge = (language?: string) => {
    if (!language) return null;
    return (
      <Badge variant="secondary" className="text-xs">
        <Code className="mr-1 h-3 w-3" />
        {language}
      </Badge>
    );
  };

  const getFileName = (filePath: string) => {
    return filePath.split("/").pop() || filePath;
  };

  const removeFileExtension = (fileName: string) => {
    const lastDotIndex = fileName.lastIndexOf(".");
    if (lastDotIndex > 0 && lastDotIndex < fileName.length - 1) {
      return fileName.substring(0, lastDotIndex);
    }
    return fileName;
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
          <h3 className="mb-2 text-lg font-medium">Loading codebase...</h3>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground text-center">
          <FileText className="mx-auto mb-4 h-8 w-8" />
          <h3 className="mb-2 text-lg font-medium">Error loading codebase</h3>
          <p className="text-sm">
            {error instanceof Error ? error.message : "Failed to load codebase"}
          </p>
        </div>
      </div>
    );
  }

  if (summaries.length === 0 && codebase) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground text-center">
          <FileText className="mx-auto mb-4 h-8 w-8" />
          <h3 className="mb-2 text-lg font-medium">No documentation found</h3>
          <p className="mb-4 text-sm">
            Generate summaries for this repository to see documentation
          </p>
          {codebase.tasks?.[0]?.id && (
            <Button
              onClick={generateSummary}
              disabled={isGenerating}
              className="mx-auto"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Summary
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex size-full max-h-svh flex-col overflow-y-auto">
      <div className="bg-background sticky top-0 z-10 flex w-full shrink-0 items-center justify-start overflow-hidden p-3">
        {!open && (
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarTrigger />
            </TooltipTrigger>
            <TooltipContent side="right" shortcut="⌘B">
              {open ? "Close Sidebar" : "Open Sidebar"}
            </TooltipContent>
          </Tooltip>
        )}
        <div className="truncate px-2">{/* {codebase.title} */}TITLE</div>
      </div>

      <div className="relative z-0 mx-auto flex w-full max-w-2xl flex-col items-center px-4 sm:px-6">
        {/* Overview */}
        {overview && (
          <div id={overview.id} className="mb-12">
            <div className="mb-4 flex items-center gap-3">
              <FolderGit2 className="h-5 w-5" />
              <h2 className="text-xl font-semibold">Project Overview</h2>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={overview.content} />
            </div>
          </div>
        )}
        {/* Files */}
        {fileSummaries.length > 0 && (
          <div id="files" className="mb-12">
            <div className="mb-6 flex items-center gap-3">
              <FileText className="h-5 w-5 text-slate-500" />
              <h2 className="text-xl font-semibold">Files</h2>
            </div>
            <div className="space-y-10">
              {fileSummaries.map((file) => (
                <div key={file.id} id={file.id} className="rounded-md">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-medium">
                      {removeFileExtension(getFileName(file.filePath || ""))}
                    </h3>
                    {file.language && getLanguageBadge(file.language)}
                  </div>
                  <div className="prose prose-sm dark:prose-invert bg-muted/30 max-w-none rounded-md p-4">
                    <MarkdownRenderer content={file.content} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Directories */}
        {directorySummaries.length > 0 && (
          <div id="directories">
            <div className="mb-6 flex items-center gap-3">
              <FolderOpen className="h-5 w-5 text-amber-500" />
              <h2 className="text-xl font-semibold">Directories</h2>
            </div>
            <div className="space-y-10">
              {directorySummaries.map((directory) => (
                <div
                  key={directory.id}
                  id={directory.id}
                  className="rounded-md"
                >
                  <div className="mb-3">
                    <h3 className="text-lg font-medium">
                      {directory.filePath}/
                    </h3>
                  </div>
                  <div className="prose prose-sm dark:prose-invert bg-muted/30 max-w-none rounded-md p-4">
                    <MarkdownRenderer content={directory.content} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
