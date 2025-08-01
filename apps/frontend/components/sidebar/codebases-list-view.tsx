import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarCodebase } from "@/lib/db-operations/get-codebases";
import { LayoutGrid, Clock } from "lucide-react";

export function SidebarCodebasesListView({
  codebases,
  loading,
  error,
}: {
  codebases: SidebarCodebase[];
  loading: boolean;
  error: Error | null;
}) {
  return (
    <>
      {loading && (
        <SidebarGroup>
          <SidebarGroupLabel>Loading codebases...</SidebarGroupLabel>
        </SidebarGroup>
      )}

      {error && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-red-400">
            Error: {error instanceof Error ? error.message : String(error)}
          </SidebarGroupLabel>
        </SidebarGroup>
      )}

      {!loading && !error && codebases.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupContent>
            {codebases.map((codebase) => {
              return (
                <SidebarMenuItem key={codebase.id}>
                  <SidebarMenuButton
                    className="flex h-auto flex-col items-start gap-0"
                    asChild
                  >
                    <a href={`/codebases/${codebase.id}`}>
                      <div className="flex w-full items-center gap-1.5">
                        <div className="line-clamp-1 flex-1">
                          {codebase.repoFullName}
                        </div>
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1 text-xs">
                        <LayoutGrid className="size-3 shrink-0" />
                        <span>{codebase.tasks.length} Tasks</span>
                        <Clock className="size-3 shrink-0" />
                        <span>{new Date(codebase.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarGroupContent>
        </SidebarGroup>
      ) : (
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground hover:text-muted-foreground h-auto px-0 pt-2 leading-tight">
            No codebases documented. Start a new task to document a codebase.
          </SidebarGroupLabel>
        </SidebarGroup>
      )}
    </>
  );
}
