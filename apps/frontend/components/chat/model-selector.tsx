import { ModelInfos, ModelType } from "@repo/types";
import { useEffect, useState } from "react";
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
import { Layers, Square } from "lucide-react";
import { useModels } from "@/hooks/use-models";

export function ModelSelector({
  isHome,
  selectedModel,
  handleSelectModel,
}: {
  isHome?: boolean;
  selectedModel: ModelType;
  handleSelectModel: (model: ModelType) => void;
}) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);

  const { data: availableModels = [] } = useModels();

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
              {isHome && <Layers className="size-4" />}
              <span>
                {selectedModel
                  ? ModelInfos[selectedModel].name
                  : "Select model"}
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
        className="flex flex-col gap-0.5 rounded-lg p-1"
      >
        {availableModels.map((model) => (
          <Button
            key={model.id}
            size="sm"
            variant="ghost"
            className="hover:bg-accent justify-start font-normal"
            onClick={() => handleSelectModel(model.id as ModelType)}
          >
            <Square className="size-4" />
            {model.name}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
