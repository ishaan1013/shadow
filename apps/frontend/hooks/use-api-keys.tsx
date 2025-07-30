import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface ApiKeys {
  openai: string;
  anthropic: string;
}

async function fetchApiKeys(): Promise<ApiKeys> {
  const response = await fetch("/api/api-keys");
  if (!response.ok) {
    throw new Error("Failed to fetch API keys");
  }
  return response.json();
}

async function saveApiKey({ provider, key }: { provider: string; key: string }) {
  const response = await fetch("/api/api-keys", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider, key }),
  });
  
  if (!response.ok) {
    throw new Error("Failed to save API key");
  }
  
  return response.json();
}

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: fetchApiKeys,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

export function useSaveApiKey() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: saveApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export function useClearApiKey() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (provider: string) => {
      return saveApiKey({ provider, key: "" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}