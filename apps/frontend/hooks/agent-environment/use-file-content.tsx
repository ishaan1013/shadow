import { SHADOW_WIKI_PATH } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export interface FileContentResponse {
  success: boolean;
  content?: string;
  path?: string;
  size?: number;
  truncated?: boolean;
  error?: string;
  errorType?: "FILE_NOT_FOUND" | "UNKNOWN";
}

export function useFileContent(taskId: string, filePath?: string, variantId?: string | null) {
  return useQuery({
    queryKey: ["file-content", taskId, variantId, filePath],
    queryFn: async (): Promise<FileContentResponse> => {
      if (filePath === SHADOW_WIKI_PATH) {
        return {
          success: true,
          content: "",
        };
      }

      if (!filePath) {
        throw new Error("File path is required");
      }

      const params = new URLSearchParams({ path: filePath });
      if (variantId) params.set("variantId", variantId);
      const res = await fetch(`/api/tasks/${taskId}/files/content?${params}`);

      if (!res.ok) {
        const data = await res.json();

        // Show toast for file not found errors
        if (data.errorType === "FILE_NOT_FOUND") {
          toast.error(`File not found: ${filePath}`, {
            description: "The file you're trying to view does not exist.",
          });
        }

        throw new Error(data.error || "Failed to fetch file content");
      }

      return res.json();
    },
    enabled: !!taskId && !!variantId && !!filePath,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
