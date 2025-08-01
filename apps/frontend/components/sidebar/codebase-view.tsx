"use client";

import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { FileText, FolderOpen, FolderGit2 } from "lucide-react";
import { useMemo } from "react";
import { useCodebase } from "@/hooks/use-codebase";

export function SidebarCodebaseView({ codebaseId }: { codebaseId: string }) {
  const { data: codebase } = useCodebase(codebaseId);

  const summaries = useMemo(() => codebase?.summaries || [], [codebase]);

  // Organize summaries for table of contents
  const { repoSummaries, fileSummaries, directorySummaries } = useMemo(() => {
    const repoSummaries = summaries.filter((s) => s.type === "repo_summary");
    const fileSummaries = summaries.filter((s) => s.type === "file_summary");
    const directorySummaries = summaries.filter(
      (s) => s.type === "directory_summary"
    );
    return { repoSummaries, fileSummaries, directorySummaries };
  }, [summaries]);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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

  if (summaries.length === 0) {
    return (
      <SidebarContent className="h-full">
        <SidebarGroup>
          <SidebarGroupLabel>Table of Contents</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="flex flex-1 items-center justify-center py-8">
              <div className="text-muted-foreground text-center text-sm">
                <FolderGit2 className="mx-auto mb-2 size-8 opacity-50" />
                <p>No documentation available</p>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    );
  }

  return (
    <SidebarContent className="h-full">
      {/* Project Overview */}
      {repoSummaries.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Overview</SidebarGroupLabel>
          <SidebarGroupContent>
            {repoSummaries.map((summary) => (
              <SidebarMenuItem key={summary.id}>
                <SidebarMenuButton onClick={() => scrollToSection(summary.id)}>
                  <FolderGit2 className="size-4 shrink-0" />
                  <span className="truncate">Project Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* Files */}
      {fileSummaries.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Files</SidebarGroupLabel>
          <SidebarGroupContent>
            {fileSummaries.map((file) => (
              <SidebarMenuItem key={file.id}>
                <SidebarMenuButton onClick={() => scrollToSection(file.id)}>
                  <FileText className="size-4 shrink-0" />
                  <span className="truncate">
                    {removeFileExtension(getFileName(file.filePath || ""))}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* Directories */}
      {directorySummaries.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Directories</SidebarGroupLabel>
          <SidebarGroupContent>
            {directorySummaries.map((directory) => (
              <SidebarMenuItem key={directory.id}>
                <SidebarMenuButton
                  onClick={() => scrollToSection(directory.id)}
                >
                  <FolderOpen className="size-4 shrink-0" />
                  <span className="truncate">{directory.filePath}/</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </SidebarContent>
  );
}
