-- AI SDK Migration
-- This migration updates the database schema to support AI SDK features

-- Add new enums
CREATE TYPE "FinishReason" AS ENUM ('STOP', 'LENGTH', 'CONTENT_FILTER', 'TOOL_CALLS', 'ERROR', 'OTHER', 'UNKNOWN');
CREATE TYPE "ToolStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'ERROR');

-- Add new columns to ChatMessage
ALTER TABLE "ChatMessage" ADD COLUMN "finishReason" "FinishReason";
ALTER TABLE "ChatMessage" ADD COLUMN "toolInvocations" JSONB;

-- Create ToolCall table
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" JSONB,
    "status" "ToolStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "taskId" TEXT NOT NULL,
    "messageId" TEXT,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX "ToolCall_taskId_createdAt_idx" ON "ToolCall"("taskId", "createdAt");
CREATE INDEX "ToolCall_toolCallId_idx" ON "ToolCall"("toolCallId");

-- Add foreign key constraints
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Update Task table to include toolCalls relationship (this is handled by Prisma, no SQL needed)

-- Add comment to document the migration
COMMENT ON TABLE "ToolCall" IS 'AI SDK tool call tracking with execution status and results';
COMMENT ON COLUMN "ChatMessage"."finishReason" IS 'AI SDK finish reason for response completion';
COMMENT ON COLUMN "ChatMessage"."toolInvocations" IS 'JSON array of tool invocations for assistant messages';