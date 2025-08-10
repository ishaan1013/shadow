import { ModelInfos, ModelType, getModelProvider } from "@repo/types";
import { useEffect, useState } from "react";
import { useModal } from "@/components/layout/modal-context";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Box } from "lucide-react";
import { useModels } from "@/hooks/use-models";
import { useApiKeys, useApiKeyValidation } from "@/hooks/use-api-keys";

export function ModelSelector({
  selectedModel,
  handleSelectModel,
}: {
  selectedModel: ModelType | null;
  handleSelectModel: (model: ModelType | null) => void;
}) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const { openSettingsModal } = useModal();

  const { data: availableModels = [] } = useModels();
  const { data: apiKeys } = useApiKeys();
  const { data: validationState } = useApiKeyValidation();

  // Filter models based on valid API keys only
  const filteredModels = availableModels.filter((model) => {
    const provider = getModelProvider(model.id as ModelType);

    // Check if we have a valid API key for this provider
    const hasKey = !!apiKeys?.[provider];

    // If validation state is not available, assume valid if we have a key
    // This prevents filtering out all models when validation is still loading
    const isValid = validationState?.[provider]?.isValid !== false;

    return hasKey && isValid;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "." && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setIsModelSelectorOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Popover open={isModelSelectorOpen} onOpenChange={setIsModelSelectorOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:bg-accent px-2 font-normal"
            >
              <span>
                {selectedModel
                  ? ModelInfos[selectedModel].name
                  : "No Model Selected"}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        {!isModelSelectorOpen && (
          <TooltipContent side="top" align="start" shortcut="⌘.">
            Model Selector
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        align="start"
        className="flex flex-col gap-0.5 overflow-hidden rounded-lg p-0"
      >
        <div className="flex flex-col gap-0.5 rounded-lg p-1.5">
          {filteredModels.length > 0 ? (
            filteredModels.map((model) => (
              <Button
                key={model.id}
                size="sm"
                variant="ghost"
                className="hover:bg-accent justify-start font-normal"
                onClick={() => handleSelectModel(model.id as ModelType)}
              >
                <span>{model.name}</span>
              </Button>
            ))
          ) : (
            <div className="text-muted-foreground p-2 text-left text-sm">
              No models available. Configure and validate your API keys to begin
              using Shadow.
            </div>
          )}
        </div>
        <button
          className="hover:bg-sidebar-accent flex h-9 w-full cursor-pointer items-center gap-2 border-t px-3 text-sm transition-colors"
          onClick={() => {
            setIsModelSelectorOpen(false);
            openSettingsModal("models");
          }}
        >
          <Box className="size-4" />
          <span>Manage API Keys</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
