"use client";

import { patchMonacoWithShiki } from "@/lib/editor/highlighter";
import { AlertTriangle, ChevronRight, ChevronsRight } from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { getLanguageFromPath } from "@repo/types";
import { LogoHover } from "../graphics/logo/logo-hover";
import { MarkdownRenderer } from "./markdown-renderer";

// Dynamic import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="bg-background flex size-full items-center justify-center">
      Loading editor...
    </div>
  ),
});

export function Editor({
  selectedFilePath,
  selectedFileContent,
  isExplorerCollapsed,
  onToggleCollapse,
  isLoadingContent,
  contentError,
}: {
  selectedFilePath?: string | null;
  selectedFileContent?: string;
  isExplorerCollapsed: boolean;
  onToggleCollapse: () => void;
  isLoadingContent?: boolean;
  contentError?: string;
}) {
  const [isShikiReady, setIsShikiReady] = useState(false);

  // Extract content string or object
  const fileContentString = selectedFileContent || "";

  // Check if the selected file is a markdown file
  const isMarkdownFile =
    selectedFilePath?.endsWith(".md") ||
    selectedFilePath?.endsWith(".markdown");

  useEffect(() => {
    patchMonacoWithShiki().then(() => {
      setIsShikiReady(true);
    });
  }, []);

  return (
    <div className="bg-background flex size-full flex-col">
      <div className="border-sidebar-border bg-card h-13 flex items-center gap-2 border-b px-2">
        {isExplorerCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="iconSm"
                className="hover:bg-sidebar-accent"
                onClick={onToggleCollapse}
              >
                <ChevronsRight className="size-4" />
              </Button>
            </TooltipTrigger>

            <TooltipContent side="right">Open File Explorer</TooltipContent>
          </Tooltip>
        )}
        <div className="flex flex-col items-start justify-center">
          <div className="select-none text-sm">Code Editor</div>
          <div className="text-muted-foreground flex items-center gap-0.5 text-[13px]">
            {selectedFilePath
              ? selectedFilePath.split("/").map((part, index) => (
                  <Fragment key={index}>
                    {index > 1 && (
                      <span className="text-muted-foreground">
                        <ChevronRight className="size-3" />
                      </span>
                    )}
                    <span className="text-muted-foreground leading-tight">
                      {part}
                    </span>
                  </Fragment>
                ))
              : "No file selected"}
          </div>
        </div>
      </div>
      <div className="code-editor relative z-0 flex-1 overflow-hidden pl-2">
        {(isLoadingContent || contentError || !selectedFilePath) && (
          <div className="bg-background text-muted-foreground absolute inset-0 z-10 flex select-none items-center justify-center gap-2 text-sm">
            {isLoadingContent ? (
              <div className="flex items-center gap-2">
                <LogoHover size="sm" forceAnimate className="opacity-60" />
                Loading file content
              </div>
            ) : contentError ? (
              <div className="flex items-center justify-center gap-2 break-words leading-none">
                <AlertTriangle className="text-destructive size-4 shrink-0" />
                Error loading file: {contentError || "Unknown error"}
              </div>
            ) : (
              <div>No file selected</div>
            )}
          </div>
        )}
        {isMarkdownFile && fileContentString ? (
          <div className="h-full overflow-auto p-4">
            <MarkdownRenderer content={fileContentString} />
          </div>
        ) : (
          <MonacoEditor
            height="100%"
            language={
              selectedFilePath
                ? getLanguageFromPath(selectedFilePath)
                : "plaintext"
            }
            value={fileContentString}
            theme={isShikiReady ? "vesper" : "vs-dark"}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              lineNumbersMinChars: 2,
              padding: {
                top: 8,
                bottom: 8,
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
