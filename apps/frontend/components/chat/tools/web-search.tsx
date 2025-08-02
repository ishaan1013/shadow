import type { Message, WebSearchResult } from "@repo/types";
import { ExternalLink, Globe } from "lucide-react";
import { ToolTypes } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";
import { getToolResult } from "@repo/types";

export function WebSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status } = toolMeta;
  const query = args.query as string;
  const domain = args.domain as string | undefined;

  const result = getToolResult(
    toolMeta,
    "web_search"
  ) as WebSearchResult | null;

  const title = domain ? `"${query}" in ${domain}` : `"${query}"`;

  return (
    <ToolComponent
      icon={<Globe />}
      type={ToolTypes.WEB_SEARCH}
      title={title}
      collapsible
    >
      {result?.results && Array.isArray(result.results) ? (
        <div>
          <div className="text-muted-foreground mb-2 text-xs">
            {result.results.length} results
          </div>
          <div className="space-y-3">
            {result.results.slice(0, 3).map((item, index) => (
              <div
                key={index}
                className="border-border bg-card rounded-md border p-3"
              >
                <div className="mb-1 flex items-start gap-2">
                  <ExternalLink className="text-muted-foreground mt-0.5 size-3 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    {item.title && (
                      <div className="text-sm font-medium leading-tight">
                        {item.title.length > 80
                          ? `${item.title.substring(0, 80)}...`
                          : item.title}
                      </div>
                    )}
                    <div className="text-muted-foreground whitespace-pre-wrap text-xs">
                      {item.text.length > 300
                        ? `${item.text.substring(0, 300)}...`
                        : item.text}
                    </div>
                    <div className="text-muted-foreground mt-1 truncate text-xs">
                      <span className="opacity-70">{item.url}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : result && status === "COMPLETED" ? (
        <div>
          <div className="text-muted-foreground mb-1 text-xs">Results:</div>
          <div className="max-h-40 overflow-y-auto rounded-md border bg-gray-50 p-3 text-xs dark:bg-gray-900/50">
            <div className="text-muted-foreground whitespace-pre-wrap">
              {result?.message || "No results found"}
            </div>
          </div>
        </div>
      ) : null}
    </ToolComponent>
  );
}
