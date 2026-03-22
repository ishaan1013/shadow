"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useApiKeys,
  useSaveApiKey,
  useClearApiKey,
  useApiKeyValidation,
  useSaveApiKeyValidation,
} from "@/hooks/api-keys/use-api-keys";
import { useValidateApiKeys } from "@/hooks/api-keys/use-api-key-validation";
import {
  Loader2,
  Trash,
  CheckCircle2,
  X,
  Settings,
  Eye,
  EyeOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDebounceCallbackWithCancel } from "@/lib/debounce";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiKeyProvider,
  ModelType,
  ModelInfos,
  getProviderDefaultModel,
  getModelProvider,
} from "@repo/types";
import { useModal } from "@/components/layout/modal-context";
import { getModelSelectorCookie } from "@/lib/actions/model-selector-cookie";
import { useSetSelectedModel } from "@/hooks/chat/use-selected-model";
import { getValidationResult } from "@/lib/types/validation";
import {
  useUserSettings,
  useUpdateUserSettings,
} from "@/hooks/use-user-settings";
import { getAllPossibleModelsInfo } from "@/lib/actions/api-keys";

// Mini models available per provider for Shadow Wiki processing
const MINI_MODELS: Record<string, { id: ModelType; name: string }[]> = {
  openai: [
    { id: "gpt-4o-mini" as ModelType, name: "GPT-4o Mini" },
    { id: "gpt-4.1-mini" as ModelType, name: "GPT-4.1 Mini" },
    { id: "gpt-5-mini-2025-08-07" as ModelType, name: "GPT-5 Mini" },
  ],
  anthropic: [
    { id: "claude-3-5-haiku-20241022" as ModelType, name: "Claude 3.5 Haiku" },
  ],
  openrouter: [
    { id: "x-ai/grok-3" as ModelType, name: "Grok 3" },
    {
      id: "deepseek/deepseek-chat-v3-0324" as ModelType,
      name: "DeepSeek Chat V3",
    },
    { id: "qwen/qwen3-coder" as ModelType, name: "Qwen3 Coder" },
  ],
};

export function ModelSettings() {
  const { data: apiKeys, isLoading: isLoadingApiKeys } = useApiKeys();
  const { data: validationState } = useApiKeyValidation();
  const saveApiKeyMutation = useSaveApiKey();
  const clearApiKeyMutation = useClearApiKey();
  const validateApiKeysMutation = useValidateApiKeys();
  const saveValidationMutation = useSaveApiKeyValidation();
  const queryClient = useQueryClient();
  const { openProviderConfig } = useModal();
  const setSelectedModelMutation = useSetSelectedModel();
  const { data: userSettings } = useUserSettings();
  const updateUserSettings = useUpdateUserSettings();

  // Compute available mini models based on which API keys the user has
  const availableMiniModels = Object.entries(MINI_MODELS)
    .filter(([provider]) => apiKeys?.[provider as keyof typeof apiKeys])
    .flatMap(([, models]) => models);

  const [openaiInput, setOpenaiInput] = useState(apiKeys?.openai ?? "");
  const [anthropicInput, setAnthropicInput] = useState(
    apiKeys?.anthropic ?? ""
  );
  const [openrouterInput, setOpenrouterInput] = useState(
    apiKeys?.openrouter ?? ""
  );
  const [savingOpenai, setSavingOpenai] = useState(false);
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  const [savingOpenrouter, setSavingOpenrouter] = useState(false);

  const [apiKeyVisibility, setApiKeyVisibility] = useState<
    Record<ApiKeyProvider, boolean>
  >({
    openai: false,
    anthropic: false,
    openrouter: false,
  });

  const handleToggleShowApiKey = (provider: ApiKeyProvider) => {
    setApiKeyVisibility((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const renderValidationIcon = (provider: string) => {
    const result = validationState?.[provider as keyof typeof validationState];
    if (!result || !apiKeys?.[provider as keyof typeof apiKeys]) return null;

    if (result.isValid) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <CheckCircle2 className="size-3.5 text-green-400" />
          </TooltipTrigger>
          <TooltipContent>Valid API key</TooltipContent>
        </Tooltip>
      );
    } else {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <X className="text-destructive size-3.5" />
          </TooltipTrigger>
          <TooltipContent>{result.error || "Invalid API key"}</TooltipContent>
        </Tooltip>
      );
    }
  };

  useEffect(() => {
    setOpenaiInput(apiKeys?.openai ?? "");
    setAnthropicInput(apiKeys?.anthropic ?? "");
    setOpenrouterInput(apiKeys?.openrouter ?? "");
  }, [apiKeys]);

  const saveApiKey = async (provider: ApiKeyProvider, key: string) => {
    // Only save if key is different from current saved value
    const currentKey =
      provider === "openai"
        ? apiKeys?.openai
        : provider === "anthropic"
          ? apiKeys?.anthropic
          : provider === "openrouter"
            ? apiKeys?.openrouter
            : undefined;
    if (key === currentKey) {
      if (provider === "openai") setSavingOpenai(false);
      else if (provider === "anthropic") setSavingAnthropic(false);
      else if (provider === "openrouter") setSavingOpenrouter(false);
      return;
    }

    // Detect if this will be a 0→1 API key transition
    const currentKeyCount = Object.values(apiKeys || {}).filter((k) =>
      k?.trim()
    ).length;
    const hadKeyBefore = !!apiKeys?.[provider]?.trim();
    const isFirstApiKey = currentKeyCount === 0 && key.trim() && !hadKeyBefore;

    try {
      await saveApiKeyMutation.mutateAsync({ provider, key });
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });

      // Validate the key after saving if it's not empty
      const trimmedKey = key.trim();
      if (trimmedKey) {
        try {
          // Wait a bit for the API key to be saved before validating
          await new Promise((resolve) => setTimeout(resolve, 100));

          const results = await validateApiKeysMutation.mutateAsync(provider);

          // Save validation results for each provider that was validated
          const savePromises = Object.entries(results)
            .filter(([key]) => key !== "individualVerification")
            .map(async ([validationProvider, result]) => {
              try {
                await saveValidationMutation.mutateAsync({
                  provider: validationProvider as ApiKeyProvider,
                  validation: result,
                });
              } catch (saveError) {
                console.error(
                  `Failed to save validation for ${validationProvider}:`,
                  saveError
                );
              }
            });

          await Promise.all(savePromises);

          // Show toast notification for individual validation
          if (results.individualVerification) {
            const validationResult = getValidationResult(results, provider);
            if (validationResult?.isValid) {
              toast.success(
                `${provider.charAt(0).toUpperCase() + provider.slice(1)} API key validated successfully!`
              );

              // Auto-select first model if this was the user's first API key
              if (isFirstApiKey) {
                try {
                  const firstModel = getProviderDefaultModel(provider);
                  await setSelectedModelMutation.mutateAsync(firstModel);
                } catch (error) {
                  console.error("Failed to auto-select model:", error);
                }
              }
            } else {
              toast.error(
                `${provider.charAt(0).toUpperCase() + provider.slice(1)} API key validation failed: ${validationResult?.error || "Unknown error"}`
              );
            }
          }

          // Invalidate validation query to refresh the UI
          queryClient.invalidateQueries({ queryKey: ["api-key-validation"] });
        } catch (validationError) {
          console.error("Validation failed:", validationError);
          // Don't throw here - we still want to save the API key even if validation fails
        }
      } else {
        // Clear validation result if key is empty
        await saveValidationMutation.mutateAsync({
          provider,
          validation: null,
        });
        queryClient.invalidateQueries({ queryKey: ["api-key-validation"] });
      }
    } catch (_error) {
      const providerName =
        provider === "openai"
          ? "OpenAI"
          : provider === "anthropic"
            ? "Anthropic"
            : provider === "openrouter"
              ? "OpenRouter"
              : "Unknown";
      toast.error(`Failed to save ${providerName} API key`);
    } finally {
      if (provider === "openai") setSavingOpenai(false);
      else if (provider === "anthropic") setSavingAnthropic(false);
      else if (provider === "openrouter") setSavingOpenrouter(false);
    }
  };

  const { debouncedCallback: debouncedSaveOpenai, cancel: cancelOpenaiSave } =
    useDebounceCallbackWithCancel(
      (key: string) => saveApiKey("openai", key),
      200
    );

  const {
    debouncedCallback: debouncedSaveAnthropic,
    cancel: cancelAnthropicSave,
  } = useDebounceCallbackWithCancel(
    (key: string) => saveApiKey("anthropic", key),
    200
  );

  const {
    debouncedCallback: debouncedSaveOpenrouter,
    cancel: cancelOpenrouterSave,
  } = useDebounceCallbackWithCancel(
    (key: string) => saveApiKey("openrouter", key),
    200
  );

  const handleOpenaiChange = (value: string) => {
    setOpenaiInput(value);
    setSavingOpenai(true);
    debouncedSaveOpenai(value);
  };

  const handleAnthropicChange = (value: string) => {
    setAnthropicInput(value);
    setSavingAnthropic(true);
    debouncedSaveAnthropic(value);
  };

  const handleOpenrouterChange = (value: string) => {
    setOpenrouterInput(value);
    setSavingOpenrouter(true);
    debouncedSaveOpenrouter(value);
  };

  const handleClearApiKey = async (provider: ApiKeyProvider) => {
    try {
      // Check if currently selected model belongs to this provider and clear it if so
      try {
        const currentModel = await getModelSelectorCookie();
        if (currentModel && getModelProvider(currentModel) === provider) {
          await setSelectedModelMutation.mutateAsync(null);
        }
      } catch (error) {
        console.error("Failed to check/clear model selector cookie:", error);
      }

      await clearApiKeyMutation.mutateAsync(provider);
      if (provider === "openai") {
        setOpenaiInput("");
        cancelOpenaiSave();
        setSavingOpenai(false);
      } else if (provider === "anthropic") {
        setAnthropicInput("");
        cancelAnthropicSave();
        setSavingAnthropic(false);
      } else if (provider === "openrouter") {
        setOpenrouterInput("");
        cancelOpenrouterSave();
        setSavingOpenrouter(false);
      }

      // Clear validation result for this provider
      await saveValidationMutation.mutateAsync({
        provider,
        validation: null,
      });

      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["api-key-validation"] });
    } catch (_error) {
      const providerName =
        provider === "openai"
          ? "OpenAI"
          : provider === "anthropic"
            ? "Anthropic"
            : provider === "openrouter"
              ? "OpenRouter"
              : "Unknown";
      toast.error(`Failed to clear ${providerName} API key`);
    }
  };

  if (isLoadingApiKeys) {
    return (
      <div className="text-muted-foreground flex items-center gap-1">
        Loading... <Loader2 className="size-3.5 animate-spin" />
      </div>
    );
  }

  const providers = [
    {
      key: "openai",
      name: "OpenAI",
      input: openaiInput,
      saving: savingOpenai,
      handleChange: handleOpenaiChange,
    },
    {
      key: "anthropic",
      name: "Anthropic",
      input: anthropicInput,
      saving: savingAnthropic,
      handleChange: handleAnthropicChange,
    },
    {
      key: "openrouter",
      name: "OpenRouter",
      input: openrouterInput,
      saving: savingOpenrouter,
      handleChange: handleOpenrouterChange,
    },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      {providers.map((provider) => {
        const hasValidKey =
          apiKeys?.[provider.key as keyof typeof apiKeys] &&
          (apiKeys[provider.key as keyof typeof apiKeys] as string)?.length > 0;

        return (
          <div key={provider.key} className="flex w-full flex-col gap-2">
            <Label
              htmlFor={`${provider.key}-key`}
              className="flex h-5 items-center gap-2 font-normal"
            >
              {provider.name} API Key
              {provider.saving && (
                <Loader2 className="text-muted-foreground size-3 animate-spin" />
              )}
              {renderValidationIcon(provider.key)}
            </Label>
            <div className="flex gap-2">
              <Input
                id={`${provider.key}-key`}
                type={
                  apiKeyVisibility[provider.key as ApiKeyProvider]
                    ? "text"
                    : "password"
                }
                autoComplete="off"
                placeholder={`sk-${provider.key === "openai" ? "" : provider.key === "anthropic" ? "ant-" : "or-"}placeholder...`}
                value={provider.input}
                onChange={(e) => provider.handleChange(e.target.value)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    className="text-muted-foreground hover:text-foreground"
                    size="icon"
                    onClick={() =>
                      handleToggleShowApiKey(provider.key as ApiKeyProvider)
                    }
                    disabled={!provider.input.trim().length}
                  >
                    {apiKeyVisibility[provider.key as ApiKeyProvider] ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {apiKeyVisibility[provider.key as ApiKeyProvider]
                    ? "Hide API Key"
                    : "Show API Key"}
                </TooltipContent>
              </Tooltip>
              {hasValidKey && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      className="text-muted-foreground hover:text-foreground"
                      size="icon"
                      onClick={() =>
                        openProviderConfig(provider.key as ApiKeyProvider)
                      }
                    >
                      <Settings className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Configure {provider.name} Models
                  </TooltipContent>
                </Tooltip>
              )}
              {hasValidKey && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      className="text-muted-foreground hover:text-foreground"
                      size="icon"
                      onClick={() =>
                        handleClearApiKey(provider.key as ApiKeyProvider)
                      }
                    >
                      <Trash className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Clear API Key</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        );
      })}

      {/* Mini Model Selection */}
      {availableMiniModels.length > 0 && (
        <div className="flex w-full flex-col gap-2 border-t pt-4">
          <Label className="font-normal">
            Shadow Wiki Mini Model
          </Label>
          <p className="text-muted-foreground text-xs">
            Used for file analysis and code summarization in Shadow Wiki. A
            smaller, faster model keeps costs low.
          </p>
          <Select
            value={userSettings?.miniModel ?? "auto"}
            onValueChange={(value) => {
              updateUserSettings.mutate({
                miniModel: value === "auto" ? null : value,
              });
            }}
          >
            <SelectTrigger data-size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" data-size="sm">
                Auto (provider default)
              </SelectItem>
              {availableMiniModels.map((model) => (
                <SelectItem key={model.id} value={model.id} data-size="sm">
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="text-muted-foreground flex w-full flex-col gap-1 border-t pt-4 text-xs">
        <span>Shadow is BYOK; you must provide an API key to use models.</span>
        <span>
          Keys are stored securely in cookies, never stored permanently on our
          servers.
        </span>
        <span>
          Ensure that your keys have high enough rate limits for the agent!
        </span>
      </div>
    </div>
  );
}
