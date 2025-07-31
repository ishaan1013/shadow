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
  useApiKeys,
  useSaveApiKey,
  useClearApiKey,
} from "@/hooks/use-api-keys";
import { Loader2, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDebounceCallbackWithCancel } from "@/lib/debounce";
import { useQueryClient } from "@tanstack/react-query";

export function ModelSettings() {
  const { data: apiKeys, isLoading: isLoadingApiKeys } = useApiKeys();
  const saveApiKeyMutation = useSaveApiKey();
  const clearApiKeyMutation = useClearApiKey();
  const queryClient = useQueryClient();

  useEffect(() => {
    console.log("apiKeys", apiKeys);
  }, [apiKeys]);

  const [openaiInput, setOpenaiInput] = useState(apiKeys?.openai ?? "");
  const [anthropicInput, setAnthropicInput] = useState(
    apiKeys?.anthropic ?? ""
  );
  const [savingOpenai, setSavingOpenai] = useState(false);
  const [savingAnthropic, setSavingAnthropic] = useState(false);

  useEffect(() => {
    setOpenaiInput(apiKeys?.openai ?? "");
    setAnthropicInput(apiKeys?.anthropic ?? "");
  }, [apiKeys]);

  const saveApiKey = async (provider: "openai" | "anthropic", key: string) => {
    // Only save if key is different from current saved value
    const currentKey =
      provider === "openai" ? apiKeys?.openai : apiKeys?.anthropic;
    if (key === currentKey) {
      if (provider === "openai") setSavingOpenai(false);
      else setSavingAnthropic(false);
      return;
    }

    try {
      await saveApiKeyMutation.mutateAsync({ provider, key });
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (_error) {
      toast.error(
        `Failed to save ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`
      );
    } finally {
      if (provider === "openai") setSavingOpenai(false);
      else setSavingAnthropic(false);
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

  const handleClearApiKey = async (provider: "openai" | "anthropic") => {
    try {
      await clearApiKeyMutation.mutateAsync(provider);
      if (provider === "openai") {
        setOpenaiInput("");
        cancelOpenaiSave();
        setSavingOpenai(false);
      } else {
        setAnthropicInput("");
        cancelAnthropicSave();
        setSavingAnthropic(false);
      }
    } catch (_error) {
      toast.error(
        `Failed to clear ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`
      );
    }
  };

  if (isLoadingApiKeys) {
    return (
      <div className="text-muted-foreground flex items-center gap-1">
        Loading... <Loader2 className="size-3.5 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex w-full grow flex-col gap-6">
        {/* OpenAI Section */}
        <div className="flex w-full flex-col gap-2">
          <Label
            htmlFor="openai-key"
            className="flex h-5 items-center font-normal"
          >
            OpenAI API Key
            {savingOpenai && (
              <Loader2 className="text-muted-foreground size-3 animate-spin" />
            )}
          </Label>
          <div className="flex gap-2">
            <Input
              id="openai-key"
              placeholder="sk-placeholder..."
              value={openaiInput}
              onChange={(e) => handleOpenaiChange(e.target.value)}
            />
            {apiKeys?.openai && apiKeys.openai.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    className="text-muted-foreground hover:text-foreground"
                    size="icon"
                    onClick={() => handleClearApiKey("openai")}
                    disabled={clearApiKeyMutation.isPending}
                  >
                    <Trash className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="end">
                  Clear OpenAI API key
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Anthropic Section */}
        <div className="flex w-full flex-col gap-2">
          <Label
            htmlFor="anthropic-key"
            className="flex h-5 items-center font-normal"
          >
            Anthropic API Key
            {savingAnthropic && (
              <Loader2 className="text-muted-foreground size-3 animate-spin" />
            )}
          </Label>
          <div className="flex gap-2">
            <Input
              id="anthropic-key"
              placeholder="sk-ant-placeholder..."
              value={anthropicInput}
              onChange={(e) => handleAnthropicChange(e.target.value)}
            />
            {apiKeys?.anthropic && apiKeys.anthropic.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    className="text-muted-foreground hover:text-foreground"
                    size="icon"
                    onClick={() => handleClearApiKey("anthropic")}
                    disabled={clearApiKeyMutation.isPending}
                  >
                    <Trash className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="end">
                  Clear Anthropic API key
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      <div className="text-muted-foreground flex w-full flex-col gap-1 border-t pt-4 text-xs">
        <span>Shadow is BYOK; you must provide an API key to use models.</span>
        <span>
          Keys are stored securely in browser cookies and never stored remotely.
        </span>
        <span>
          Please ensure your keys have high enough rate limits for the agent!
        </span>
      </div>
    </>
  );
}
