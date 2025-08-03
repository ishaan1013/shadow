"use client";

import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { FileNode } from "@repo/types";

interface FileChange {
  filePath: string;
  operation: string;
}

export function FileExplorer({
  files,
  onFileSelect,
  selectedFilePath,
  isCollapsed,
  onToggleCollapse,
  showDiffOperation = false,
  fileChanges = [],
  defaultExpanded = false,
  autoExpandToSelectedPath = false,
}: {
  files: FileNode[];
  onFileSelect?: (file: FileNode) => void;
  selectedFilePath?: string | null;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  showDiffOperation?: boolean;
  fileChanges?: FileChange[];
  defaultExpanded?: boolean;
  autoExpandToSelectedPath?: boolean;
}) {
  // We use a single Set to track folder state.
  // If defaultExpanded is true, the Set tracks collapsed folders (all open by default).
  // If defaultExpanded is false, the Set tracks expanded folders (all closed by default).
  // This avoids up-front tree traversal and is efficient for both modes.
  // Note that these are prefixed with a slash.
  const [folderState, setFolderState] = useState<Set<string>>(new Set());

  const toggleFolder = (path: string) => {
    setFolderState((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Auto-expand folders leading to the selected file path
  useEffect(() => {
    if (autoExpandToSelectedPath && selectedFilePath) {
      // Get all parent folder paths for the selected file
      const pathParts = selectedFilePath.split("/");
      const parentPaths: string[] = [];

      // Build all parent paths (excluding the file itself)
      for (let i = 1; i < pathParts.length; i++) {
        parentPaths.push(pathParts.slice(0, i).join("/"));
      }

      // Expand each parent folder if it's not already expanded
      setFolderState((prev) => {
        const next = new Set(prev);
        let hasChanges = false;

        parentPaths.forEach((parentPath) => {
          const shouldBeExpanded = defaultExpanded
            ? !next.has(parentPath)
            : next.has(parentPath);

          if (!shouldBeExpanded) {
            hasChanges = true;
            if (defaultExpanded) {
              // In defaultExpanded mode, remove from set to expand
              next.delete(parentPath);
            } else {
              // In normal mode, add to set to expand
              next.add(parentPath);
            }
          }
        });

        return hasChanges ? next : prev;
      });
    }
  }, [selectedFilePath, autoExpandToSelectedPath, defaultExpanded]);

  // Determine expansion based on defaultExpanded mode and folderState
  // If defaultExpanded: open unless in set; else: closed unless in set
  const isNodeExpanded = (path: string) =>
    defaultExpanded ? !folderState.has(path) : folderState.has(path);

  const getOperationColor = (op: string) => {
    switch (op) {
      case "CREATE":
        return "text-green-400";
      case "UPDATE":
        return "text-yellow-500";
      case "DELETE":
        return "text-red-400";
      default:
        return "text-neutral-500";
    }
  };

  const getOperationLetter = (op: string) => {
    switch (op) {
      case "CREATE":
        return "A";
      case "UPDATE":
        return "M";
      case "DELETE":
        return "D";
      case "RENAME":
        return "R";
      case "MOVE":
        return "M";
      default:
        return "?";
    }
  };

  const renderNode = (node: FileNode, depth = 0) => {
    const isExpanded = isNodeExpanded(node.path);
    const isSelected = selectedFilePath === node.path;
    const fileChange = showDiffOperation
      ? fileChanges.find((change) => change.filePath === node.path)
      : null;
    const operation = fileChange?.operation;

    return (
      <div key={node.path} className="relative flex flex-col gap-0.5">
        {isExpanded && (
          <div
            className="bg-border absolute bottom-0 hidden h-[calc(100%-30px)] w-px group-hover/files:block"
            style={{ left: `${depth * 12 + 12}px` }}
          />
        )}
        <div
          className={`group/item text-foreground/80 hover:text-foreground flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 hover:bg-white/10 ${
            isSelected ? "bg-white/5" : ""
          } ${showDiffOperation ? "justify-between" : ""}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            if (node.type === "folder") {
              toggleFolder(node.path);
            } else if (onFileSelect) {
              onFileSelect(node);
            }
          }}
        >
          <div className="flex items-center gap-1.5">
            {node.type === "folder" ? (
              isExpanded ? (
                <>
                  <FolderOpen className="size-4 group-hover/item:hidden" />
                  <ChevronDown className="hidden size-4 group-hover/item:block" />
                </>
              ) : (
                <>
                  <Folder className="size-4 group-hover/item:hidden" />
                  <ChevronRight className="hidden size-4 group-hover/item:block" />
                </>
              )
            ) : (
              <File className="size-4" />
            )}
            <span className="text-sm">{node.name}</span>
          </div>
          {showDiffOperation && node.type === "file" && operation && (
            <span
              className={cn(
                "text-xs font-medium",
                getOperationColor(operation)
              )}
            >
              {getOperationLetter(operation)}
            </span>
          )}
        </div>
        {node.type === "folder" && isExpanded && node.children && (
          <div className="flex flex-col gap-0.5">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // If this is being used as a collapsible sidebar (with header)
  if (isCollapsed !== undefined && onToggleCollapse) {
    if (!isCollapsed) {
      return (
        <div className="bg-sidebar border-sidebar-border flex w-52 shrink-0 select-none flex-col border-r">
          <div className="border-sidebar-border h-13 flex items-center justify-between border-b px-2">
            <h3 className="font-departureMono tracking-tight">Shadow Realm</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-sidebar-accent size-7 cursor-pointer"
                  onClick={onToggleCollapse}
                >
                  <ChevronsLeft className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end">
                Close File Explorer
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="group/files flex flex-1 flex-col gap-0.5 overflow-auto p-1">
            {files.map((file) => renderNode(file))}
          </div>
        </div>
      );
    }
    return null;
  }
  // If this is being used without the sidebar header
  return (
    <div className="group/files flex flex-col gap-0.5">
      {files.map((file) => renderNode(file))}
    </div>
  );
}
