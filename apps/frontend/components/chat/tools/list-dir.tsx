import type { Message, DirectoryListing } from "@repo/types";
import { File, Folder, FolderOpen } from "lucide-react";
import { ToolTypes } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";

export function ListDirTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const path = args.relative_workspace_path as string;

  let parsedResult: DirectoryListing | null = null;
  try {
    parsedResult = typeof result === "string" ? JSON.parse(result) : result;
  } catch {
    // If parsing fails, we'll show the raw result
  }

  return (
    <ToolComponent
      icon={<FolderOpen />}
      type={ToolTypes.LIST_DIR}
      title={path || "./"}
      collapsible
    >
      {result && status === "COMPLETED" && (
        <div>
          {parsedResult?.success && parsedResult.contents ? (
            <div className="flex flex-col gap-0.5">
              {parsedResult.contents.map((item) => (
                <div key={item.name} className="flex items-center gap-2 py-px">
                  {item.isDirectory ? (
                    <Folder className="size-4" />
                  ) : (
                    <File className="size-4" />
                  )}
                  <span>{item.name}</span>
                </div>
              ))}
              {parsedResult.contents.length === 0 && <div>Empty directory</div>}
            </div>
          ) : (
            <div className="text-destructive">
              Error listing files in directory
            </div>
          )}
        </div>
      )}
    </ToolComponent>
  );
}
