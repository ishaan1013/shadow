import type { Message } from "@repo/types";
import { FileSearch, File } from "lucide-react";
import { ToolTypes } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";
import { getToolResult } from "@repo/types";

export function FileSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status } = toolMeta;
  const query = args.query as string;

  const result = getToolResult(toolMeta, "file_search");
  const files = result?.files || [];

  return (
    <ToolComponent
      icon={<FileSearch />}
      type={ToolTypes.FILE_SEARCH}
      title={`"${query}"`}
      collapsible
    >
      {result && status === "COMPLETED" && (
        <div>
          {result.success && files.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {files.map((file: string, index: number) => (
                <div key={index} className="flex items-center gap-2 py-px">
                  <File className="size-4" />
                  <span>{file}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground">
              {result.message || "No files found"}
            </div>
          )}
        </div>
      )}
    </ToolComponent>
  );
}
