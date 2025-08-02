import { ModelInfo } from "@repo/types";
import { useQuery } from "@tanstack/react-query";

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: async (): Promise<ModelInfo[]> => {
      const response = await fetch("/api/models", {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: ModelInfo[] = await response.json();
      return data;
    },
    staleTime: 10 * 60 * 1000,
    retry: (failureCount) => failureCount < 2,
  });
}
