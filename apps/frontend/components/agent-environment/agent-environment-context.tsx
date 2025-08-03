"use client";

import { useFileContent } from "@/hooks/use-file-content";
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
  triggerTerminalResize: () => void;
  terminalResizeTrigger: number;
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

  function updateSelectedFilePath(path: string | null) {
    if (path && !path.startsWith("/")) {
      setSelectedFilePath("/" + path);
    } else {
      setSelectedFilePath(path);
    }
  }

  // Fetch file content when a file is selected
  const fileContentQuery = useFileContent(
    taskId,
    selectedFilePath || undefined
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

  const triggerTerminalResize = useCallback(() => {
    setTerminalResizeTrigger((prev) => prev + 1);
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
      triggerTerminalResize,
      terminalResizeTrigger,
    }),
    [
      selectedFilePath,
      updateSelectedFilePath,
      fileContentQuery.isLoading,
      fileContentQuery.error?.message,
      rightPanelRef,
      expandRightPanel,
      triggerTerminalResize,
      terminalResizeTrigger,
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
