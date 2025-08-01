import { useQuery } from "@tanstack/react-query";
import { SidebarCodebase } from "@/lib/db-operations/get-codebases";

export function useCodebases(initialData: SidebarCodebase[]) {
  return useQuery({
    queryKey: ["codebases"],
    queryFn: async (): Promise<SidebarCodebase[]> => {
      const res = await fetch("/api/codebases");
      if (!res.ok) throw new Error("Failed to fetch codebases");
      const data = await res.json();
      return data.codebases || [];
    },
    initialData,
  });
}