import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getApiKeys,
  saveApiKey as saveApiKeyAction,
  clearApiKey as clearApiKeyAction,
  type ApiKeyProvider,
} from "@/lib/actions/api-keys";

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: getApiKeys,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useSaveApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      provider,
      key,
    }: {
      provider: ApiKeyProvider;
      key: string;
    }) => saveApiKeyAction(provider, key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export function useClearApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: ApiKeyProvider) => clearApiKeyAction(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}
