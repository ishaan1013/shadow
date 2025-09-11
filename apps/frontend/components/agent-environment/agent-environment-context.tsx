"use client";

import { useFileContent } from "@/hooks/agent-environment/use-file-content";
import { SHADOW_WIKI_PATH } from "@/lib/constants";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTaskSocketContext } from "@/contexts/task-socket-context";
import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { ImperativePanelHandle } from "react-resizable-panels";

type FileWithContent = {
  name: string;
  type: "file";
  path: string;
  content: string;
};

type AgentEnvironmentContextType = {
  selectedFilePath: string | null;
  selectedFileWithContent: FileWithContent | null;
  updateSelectedFilePath: (path: string | null) => void;
  isLoadingContent: boolean;
  contentError: string | undefined;
  rightPanelRef: React.RefObject<ImperativePanelHandle | null>;
  lastPanelSizeRef: React.RefObject<number | null>;
  expandRightPanel: () => void;
  openAgentEnvironment: () => void;
  triggerTerminalResize: () => void;
  terminalResizeTrigger: number;
  openShadowWiki: () => void;
  // Sheet management - exposed for page components
  isSheetOpen: boolean;
  setIsSheetOpen: (open: boolean) => void;
  shouldUseSheet: boolean;
};

const AgentEnvironmentContext = createContext<
  AgentEnvironmentContextType | undefined
>(undefined);

export function AgentEnvironmentProvider({
  children,
  taskId,
}: {
  children: ReactNode;
  taskId: string;
}) {
  // This is for the resizable agent environment panel
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [terminalResizeTrigger, setTerminalResizeTrigger] = useState(0);
  
  // Sheet management
  const shouldUseSheet = useIsMobile({ breakpoint: 1024 });
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  function updateSelectedFilePath(path: string | null) {
    if (path && !path.startsWith("/") && path !== SHADOW_WIKI_PATH) {
      setSelectedFilePath("/" + path);
    } else {
      setSelectedFilePath(path);
    }
  }

  // Fetch file content when a file is selected (variant-aware)
  const { currentVariantId } = useTaskSocketContext();
  const fileContentQuery = useFileContent(
    taskId,
    selectedFilePath || undefined,
    currentVariantId
  );

  // Create selected file object with content for the editor
  const selectedFileWithContent = useMemo(() => {
    // Handle regular file content
    if (
      selectedFilePath &&
      fileContentQuery.data?.success &&
      fileContentQuery.data.content
    ) {
      return {
        name: selectedFilePath.split("/").pop() || "",
        type: "file" as const,
        path: selectedFilePath,
        content: fileContentQuery.data.content,
      };
    }
    return null;
  }, [selectedFilePath, fileContentQuery.data]);

  const lastPanelSizeRef = useRef<number | null>(null);

  const expandRightPanel = useCallback(() => {
    if (rightPanelRef.current && rightPanelRef.current.isCollapsed()) {
      const panel = rightPanelRef.current;

      panel.expand();
      if (!lastPanelSizeRef.current) {
        panel.resize(50);
      }
    }
  }, [rightPanelRef]);

  const openAgentEnvironment = useCallback(() => {
    if (shouldUseSheet) {
      setIsSheetOpen(true);
      return;
    }

    // Fall back to expanding the panel (desktop mode)
    expandRightPanel();
  }, [shouldUseSheet, expandRightPanel]);

  const openShadowWiki = useCallback(() => {
    openAgentEnvironment();
    setSelectedFilePath(SHADOW_WIKI_PATH);
  }, [openAgentEnvironment]);

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerTerminalResize = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      setTerminalResizeTrigger((prev) => prev + 1);
    }, 200);
  }, []);

  const value: AgentEnvironmentContextType = useMemo(
    () => ({
      selectedFilePath,
      selectedFileWithContent,
      updateSelectedFilePath,
      isLoadingContent: fileContentQuery.isLoading,
      contentError: fileContentQuery.error?.message,
      rightPanelRef,
      lastPanelSizeRef,
      expandRightPanel,
      openAgentEnvironment,
      triggerTerminalResize,
      terminalResizeTrigger,
      openShadowWiki,
      isSheetOpen,
      setIsSheetOpen,
      shouldUseSheet,
    }),
    [
      selectedFilePath,
      selectedFileWithContent,
      updateSelectedFilePath,
      fileContentQuery.isLoading,
      fileContentQuery.error?.message,
      rightPanelRef,
      lastPanelSizeRef,
      expandRightPanel,
      openAgentEnvironment,
      triggerTerminalResize,
      terminalResizeTrigger,
      openShadowWiki,
      isSheetOpen,
      shouldUseSheet,
    ]
  );

  return (
    <AgentEnvironmentContext.Provider value={value}>
      {children}
    </AgentEnvironmentContext.Provider>
  );
}

export function useAgentEnvironment() {
  const context = useContext(AgentEnvironmentContext);
  if (context === undefined) {
    throw new Error(
      "useAgentEnvironment must be used within an AgentEnvironmentProvider"
    );
  }
  return context;
}
