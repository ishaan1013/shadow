"use client";

import { createContext, useContext, ReactNode, useMemo } from "react";
import { useTaskSocket } from "@/hooks/socket/use-task-socket";
import type { 
  AssistantMessagePart, 
  AutoPRStatusEvent 
} from "@repo/types";
import type { TaskVariant } from "@/lib/db-operations/get-task-variants";
interface TaskSocketContextValue {
  isConnected: boolean;
  streamingPartsMap: Map<string, AssistantMessagePart>;
  streamingPartsOrder: string[];
  isStreaming: boolean;
  setIsStreaming: (isStreaming: boolean) => void;
  isCompletionPending: boolean;
  autoPRStatus: AutoPRStatusEvent | null;
  sendMessage: (message: string, model: string, queue?: boolean) => void;
  stopStream: () => void;
  clearQueuedAction: () => void;
  createStackedPR: (message: string, model: string, queue?: boolean) => void;

  // Variant-aware additions (Stage 1 minimal exposure)
  currentVariantId: string | null;
  variants: TaskVariant[];
}

const TaskSocketContext = createContext<TaskSocketContextValue | null>(null);

interface TaskSocketProviderProps {
  taskId: string;
  variants: TaskVariant[];
  children: ReactNode;
}

export function TaskSocketProvider({ taskId, variants, children }: TaskSocketProviderProps) {
  // Stage 1 action variant id: pick first by sequence (base case: one variant)
  const currentVariantId = useMemo(() => {
    if (!variants || variants.length === 0) return null;
    const sorted = [...variants].sort((a, b) => a.sequence - b.sequence);
    return sorted[0]?.id || null;
  }, [variants]);

  const socketState = useTaskSocket(taskId, currentVariantId || undefined);
  
  return (
    <TaskSocketContext.Provider value={{ ...socketState, currentVariantId, variants }}>
      {children}
    </TaskSocketContext.Provider>
  );
}

export function useTaskSocketContext(): TaskSocketContextValue {
  const context = useContext(TaskSocketContext);
  if (!context) {
    throw new Error(
      'useTaskSocketContext must be used within a TaskSocketProvider'
    );
  }
  return context;
}
