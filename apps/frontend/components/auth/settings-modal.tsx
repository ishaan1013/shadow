"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useApiKeys,
  useSaveApiKey,
  useClearApiKey,
} from "@/hooks/use-api-keys";
import { useGitHubStatus } from "@/hooks/use-github-status";
import { useGitHubRepositories } from "@/hooks/use-github-repositories";
import {
  Loader2,
  Settings,
  X,
  Box,
  User2,
  Check,
  ArrowUpRight,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/auth-client";
import { toast } from "sonner";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { GithubLogo } from "../logo/github-logo";
import { useAuthSession } from "./session-provider";

const tabs = [
  {
    title: "GitHub Connection",
    sidebarLabel: "GitHub",
    icon: <GithubLogo className="size-4" />,
    value: "github",
  },
  {
    title: "Models",
    sidebarLabel: "Models",
    icon: <Box className="size-4" />,
    value: "models",
  },
  {
    title: "User Info",
    sidebarLabel: "User",
    icon: <User2 className="size-4" />,
    value: "user",
  },
];

interface SettingsModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultTab?: string;
}

export function SettingsModal({
  open,
  onOpenChange,
  defaultTab = "user",
}: SettingsModalProps) {
  const { session, isLoading: isLoadingSession } = useAuthSession();
  const [activeTab, setActiveTab] = useState(defaultTab);
  const currentTab = tabs.find((tab) => tab.value === activeTab);

  const { data: apiKeys, isLoading: isLoadingApiKeys } = useApiKeys();

  const [openaiInput, setOpenaiInput] = useState(apiKeys?.openai ?? "");
  const [anthropicInput, setAnthropicInput] = useState(
    apiKeys?.anthropic ?? ""
  );

  useEffect(() => {
    setOpenaiInput(apiKeys?.openai ?? "");
    setAnthropicInput(apiKeys?.anthropic ?? "");
  }, [apiKeys]);

  const { data: githubStatus, isLoading: isLoadingGithub } = useGitHubStatus();
  const { data: githubRepos, isLoading: isLoadingRepos } =
    useGitHubRepositories(!!githubStatus?.isAppInstalled);

  const saveApiKeyMutation = useSaveApiKey();
  const clearApiKeyMutation = useClearApiKey();

  const handleSignOut = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = "/auth";
          },
        },
      });
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const handleSaveApiKey = async (provider: "openai" | "anthropic") => {
    const key = provider === "openai" ? openaiInput : anthropicInput;
    try {
      await saveApiKeyMutation.mutateAsync({ provider, key });
      toast.success(
        `${provider === "openai" ? "OpenAI" : "Anthropic"} API key saved successfully`
      );
    } catch (_error) {
      toast.error(
        `Failed to save ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`
      );
    }
  };

  const handleClearApiKey = async (provider: "openai" | "anthropic") => {
    try {
      await clearApiKeyMutation.mutateAsync(provider);
      if (provider === "openai") {
        setOpenaiInput("");
      } else {
        setAnthropicInput("");
      }
      toast.success(
        `${provider === "openai" ? "OpenAI" : "Anthropic"} API key cleared`
      );
    } catch (_error) {
      toast.error(
        `Failed to clear ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`
      );
    }
  };

  const UserInfoTab = () => (
    <div className="space-y-6">
      {isLoadingSession ? (
        <div className="text-muted-foreground flex items-center gap-1">
          Loading user info... <Loader2 className="size-3.5 animate-spin" />
        </div>
      ) : !session?.user ? (
        <div className="flex items-center gap-1.5 text-red-400">
          Failed to load user info <X className="size-3.5" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {session.user.image && (
              <Image
                src={session.user.image}
                alt={session.user.name || "User"}
                className="rounded-full"
                width={48}
                height={48}
              />
            )}
            <div className="flex flex-col">
              <span className="font-medium">{session.user.name}</span>
              <span className="text-muted-foreground text-sm">
                {session.user.email}
              </span>
            </div>
          </div>

          <div className="flex w-full pt-2">
            <Button
              variant="destructive"
              onClick={() => {
                handleSignOut();
                onOpenChange?.(false);
              }}
            >
              Sign Out
            </Button>
          </div>
        </>
      )}
    </div>
  );

  const ModelsTab = () => (
    <>
      {isLoadingApiKeys ? (
        <>
          <div className="text-muted-foreground flex items-center gap-1">
            Loading... <Loader2 className="size-3.5 animate-spin" />
          </div>
        </>
      ) : (
        <>
          <div className="flex w-full grow flex-col gap-6">
            {/* OpenAI Section */}
            <div className="flex w-full flex-col gap-2">
              <Label htmlFor="openai-key" className="font-normal">
                OpenAI API Key
              </Label>
              <div className="flex gap-2">
                <Input
                  id="openai-key"
                  placeholder="sk-placeholder..."
                  value={openaiInput}
                  onChange={(e) => setOpenaiInput(e.target.value)}
                />
                <Button
                  onClick={() => handleSaveApiKey("openai")}
                  size="icon"
                  disabled={saveApiKeyMutation.isPending || !openaiInput}
                >
                  {saveApiKeyMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                </Button>
                {apiKeys?.openai && (
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => handleClearApiKey("openai")}
                    disabled={clearApiKeyMutation.isPending}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Anthropic Section */}
            <div className="flex w-full flex-col gap-2">
              <Label htmlFor="anthropic-key" className="font-normal">
                Anthropic API Key
              </Label>
              <div className="flex gap-2">
                <Input
                  id="anthropic-key"
                  placeholder="sk-ant-placeholder..."
                  value={anthropicInput}
                  onChange={(e) => setAnthropicInput(e.target.value)}
                />
                <Button
                  onClick={() => handleSaveApiKey("anthropic")}
                  size="icon"
                  disabled={saveApiKeyMutation.isPending || !anthropicInput}
                >
                  {saveApiKeyMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                </Button>
                {apiKeys?.anthropic && (
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => handleClearApiKey("anthropic")}
                    disabled={clearApiKeyMutation.isPending}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="text-muted-foreground flex w-full flex-col gap-1 border-t pt-4 text-xs">
            <span>
              Shadow is BYOK; you must provide an API key to use models.
            </span>
            <span>
              Keys are stored securely in browser cookies and never stored
              remotely.
            </span>
            <span>
              Please ensure your keys have high enough rate limits for the
              agent!
            </span>
          </div>
        </>
      )}
    </>
  );

  const GitHubTab = () => (
    <>
      {isLoadingGithub ? (
        <>
          <div className="text-muted-foreground flex items-center gap-1">
            Loading... <Loader2 className="size-3.5 animate-spin" />
          </div>
        </>
      ) : githubStatus?.isAppInstalled ? (
        <>
          <div className="flex flex-col gap-3">
            <div className="text-muted-foreground flex items-center gap-1.5">
              Connected <Check className="size-3.5 text-green-400" />
            </div>
            <Button className="w-auto" variant="secondary" asChild>
              <Link
                href={`https://github.com/settings/installations/${githubStatus?.installationId}`}
                target="_blank"
                className="font-normal"
              >
                Manage on GitHub <ArrowUpRight />
              </Link>
            </Button>
          </div>
          {isLoadingRepos ? (
            <div className="text-muted-foreground flex items-center gap-1">
              Loading Repositories...{" "}
              <Loader2 className="size-3.5 animate-spin" />
            </div>
          ) : githubRepos?.groups ? (
            <div className="flex w-full flex-col gap-3">
              <div className="text-muted-foreground">Your Repositories</div>
              <div className="flex w-full flex-col gap-2">
                {githubRepos.groups.map((group) => (
                  <>
                    {group.repositories.slice(0, 10).map((repo) => (
                      <Button
                        key={repo.id}
                        variant="secondary"
                        className="w-full justify-between overflow-hidden"
                      >
                        <span className="truncate font-normal">
                          {repo.full_name}
                        </span>
                        <ArrowUpRight />
                      </Button>
                    ))}
                    {group.repositories.length > 10 && (
                      <div className="text-muted-foreground px-3 text-xs">
                        + {group.repositories.length - 10} more
                      </div>
                    )}
                  </>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-red-400">
              Not Connected <X className="size-3.5" />
            </div>
            <div className="text-muted-foreground">
              For full access, install Shadow into your organization. If
              you&apos;re seeing this and already installed, hit
              &apos;Save&apos; in Github.
            </div>
          </div>
          {githubStatus?.installationUrl && (
            <Button className="w-auto" variant="secondary" asChild>
              <Link
                href={githubStatus?.installationUrl}
                target="_blank"
                className="font-normal"
              >
                Install Github App <ArrowUpRight />
              </Link>
            </Button>
          )}
        </>
      )}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="iconSm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
        >
          <Settings />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl! h-full max-h-[500px] overflow-hidden p-0">
        <div className="flex max-h-full overflow-hidden">
          {/* Left sidebar */}
          <div className="bg-card w-40 shrink-0 border-r px-2 py-4">
            <DialogTitle className="mb-4 px-2 text-base font-medium">
              Settings
            </DialogTitle>

            <div className="flex flex-col gap-1">
              {tabs.map((tab) => (
                <Button
                  key={tab.value}
                  variant="ghost"
                  className={cn(
                    "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent px-2! w-full justify-start border border-transparent font-normal",
                    activeTab === tab.value &&
                      "bg-accent text-foreground border-sidebar-border"
                  )}
                  onClick={() => setActiveTab(tab.value)}
                >
                  {tab.icon}
                  {tab.sidebarLabel}
                </Button>
              ))}
            </div>
          </div>

          {/* Right content area */}
          <div className="flex grow flex-col gap-6">
            <div className="p-4 pb-0 font-medium">{currentTab?.title}</div>

            <div className="flex w-full grow flex-col items-start gap-6 overflow-y-auto p-4 pt-0 text-sm">
              {activeTab === "user" && <UserInfoTab />}
              {activeTab === "models" && <ModelsTab />}
              {activeTab === "github" && <GitHubTab />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
