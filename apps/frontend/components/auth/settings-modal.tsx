"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiKeys, useSaveApiKey, useClearApiKey } from "@/hooks/use-api-keys";
import { useSettings } from "@/hooks/use-settings";
import { useGitHubStatus } from "@/hooks/use-github-status";
import { useGitHubRepositories } from "@/hooks/use-github-repositories";
import { Loader2, Settings, X, Eye, EyeOff, User, Cpu, Github, ExternalLink } from "lucide-react";
import React, { useState, useEffect } from "react";
import { authClient } from "@/lib/auth/auth-client";
import { toast } from "sonner";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface SettingsModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultTab?: string;
}

export function SettingsModal({ open, onOpenChange, defaultTab = "user" }: SettingsModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [activeTab, setActiveTab] = useState(defaultTab);

  const isOpen = open !== undefined ? open : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;

  const { data: settingsData, isLoading: isLoadingSettings, error: settingsError } = useSettings(isOpen);
  const { data: apiKeys, isLoading: isLoadingApiKeys, error: apiKeysError } = useApiKeys();
  const { data: githubStatus, isLoading: isLoadingGithub } = useGitHubStatus(isOpen);
  const { data: githubRepos, isLoading: isLoadingRepos } = useGitHubRepositories(
    isOpen && !!githubStatus?.isAppInstalled
  );

  const saveApiKeyMutation = useSaveApiKey();
  const clearApiKeyMutation = useClearApiKey();

  // Initialize form values when API keys are loaded
  React.useEffect(() => {
    if (apiKeys) {
      setOpenaiKey(apiKeys.openai || "");
      setAnthropicKey(apiKeys.anthropic || "");
    }
  }, [apiKeys]);

  // Listen for custom events to open modal to specific tab
  React.useEffect(() => {
    const handleOpenModal = (event: CustomEvent) => {
      const { tab } = event.detail;
      if (tab) {
        setActiveTab(tab);
      }
      setIsOpen(true);
    };

    window.addEventListener('open-settings-modal', handleOpenModal as EventListener);
    
    return () => {
      window.removeEventListener('open-settings-modal', handleOpenModal as EventListener);
    };
  }, [setIsOpen]);

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
    const key = provider === "openai" ? openaiKey : anthropicKey;
    try {
      await saveApiKeyMutation.mutateAsync({ provider, key });
      toast.success(`${provider === "openai" ? "OpenAI" : "Anthropic"} API key saved successfully`);
    } catch (error) {
      toast.error(`Failed to save ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`);
    }
  };

  const handleClearApiKey = async (provider: "openai" | "anthropic") => {
    try {
      await clearApiKeyMutation.mutateAsync(provider);
      if (provider === "openai") {
        setOpenaiKey("");
      } else {
        setAnthropicKey("");
      }
      toast.success(`${provider === "openai" ? "OpenAI" : "Anthropic"} API key cleared`);
    } catch (error) {
      toast.error(`Failed to clear ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`);
    }
  };

  const UserInfoTab = () => (
    <div className="space-y-6">
      {isLoadingSettings ? (
        <div className="text-muted-foreground flex items-center justify-center gap-1.5 py-12">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="text-[13px]">Loading user info...</span>
        </div>
      ) : settingsError ? (
        <div className="text-muted-foreground flex items-center justify-center gap-1.5 py-12">
          <X className="text-destructive size-3.5" />
          <span className="text-[13px]">Failed to load user info</span>
        </div>
      ) : settingsData?.user ? (
        <>
          <div className="flex items-center gap-3">
            {settingsData.user.image && (
              <img
                src={settingsData.user.image}
                alt={settingsData.user.name || "User"}
                className="size-16 rounded-full"
              />
            )}
            <div className="flex flex-col">
              <span className="text-lg font-semibold">{settingsData.user.name}</span>
              <span className="text-muted-foreground">{settingsData.user.email}</span>
            </div>
          </div>

          {settingsData.stats && (
            <div className="grid w-full grid-cols-2 gap-4 border-t pt-4 text-sm">
              <div className="flex flex-col">
                <span className="text-muted-foreground">Joined</span>
                <span>
                  {settingsData.stats.joinedAt
                    ? new Date(settingsData.stats.joinedAt).toLocaleDateString()
                    : "N/A"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Total Tasks</span>
                <span>{settingsData.stats.taskCount}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Completed</span>
                <span>{settingsData.stats.completedTasks}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Pending</span>
                <span>{settingsData.stats.pendingTasks}</span>
              </div>
            </div>
          )}

          <div className="flex w-full pt-2">
            <Button
              variant="destructive"
              onClick={() => {
                handleSignOut();
                setIsOpen(false);
              }}
            >
              Sign Out
            </Button>
          </div>
        </>
      ) : (
        <p>You are not signed in.</p>
      )}
    </div>
  );

  const ModelsTab = () => (
    <div className="space-y-6">
      {isLoadingApiKeys ? (
        <div className="text-muted-foreground flex items-center justify-center gap-1.5 py-12">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="text-[13px]">Loading API keys...</span>
        </div>
      ) : (
        <>
          {/* OpenAI Section */}
          <div className="space-y-3">
            <Label htmlFor="openai-key" className="text-sm font-medium">
              OpenAI API Key
            </Label>
            <div className="space-y-2">
              <div className="relative">
                <Input
                  id="openai-key"
                  type={showOpenAIKey ? "text" : "password"}
                  placeholder="sk-..."
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-7 w-7 p-0"
                  onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                >
                  {showOpenAIKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleSaveApiKey("openai")}
                  disabled={saveApiKeyMutation.isPending}
                >
                  {saveApiKeyMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                {apiKeys?.openai && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleClearApiKey("openai")}
                    disabled={clearApiKeyMutation.isPending}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Anthropic Section */}
          <div className="space-y-3">
            <Label htmlFor="anthropic-key" className="text-sm font-medium">
              Anthropic API Key
            </Label>
            <div className="space-y-2">
              <div className="relative">
                <Input
                  id="anthropic-key"
                  type={showAnthropicKey ? "text" : "password"}
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-7 w-7 p-0"
                  onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                >
                  {showAnthropicKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleSaveApiKey("anthropic")}
                  disabled={saveApiKeyMutation.isPending}
                >
                  {saveApiKeyMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                {apiKeys?.anthropic && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleClearApiKey("anthropic")}
                    disabled={clearApiKeyMutation.isPending}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="text-muted-foreground text-xs space-y-1 border-t pt-4">
            <p>• API keys are stored securely in your browser cookies</p>
            <p>• Keys are required to use OpenAI or Anthropic models</p>
            <p>• Keys are only sent to the respective provider APIs</p>
          </div>
        </>
      )}
    </div>
  );

  const GitHubTab = () => (
    <div className="space-y-6">
      {isLoadingGithub ? (
        <div className="text-muted-foreground flex items-center justify-center gap-1.5 py-12">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="text-[13px]">Loading GitHub status...</span>
        </div>
      ) : !githubStatus || !githubStatus.isAppInstalled ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Image
              src="/github.svg"
              alt="GitHub"
              className="size-5"
              width={20}
              height={20}
            />
            <h3 className="font-medium">Connect GitHub</h3>
          </div>
          <p className="text-muted-foreground text-sm">
            Install Shadow into your GitHub organization for full access to repositories.
          </p>
          {githubStatus?.installationUrl && (
            <Button
              onClick={() => {
                window.open(githubStatus.installationUrl, "_blank");
              }}
              className="w-full"
            >
              Install GitHub App
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image
                src="/github.svg"
                alt="GitHub"
                className="size-5"
                width={20}
                height={20}
              />
              <h3 className="font-medium">GitHub Connected</h3>
            </div>
            <div className="text-green-600 text-sm">✓ Connected</div>
          </div>
          
          {isLoadingRepos ? (
            <div className="text-muted-foreground flex items-center justify-center gap-1.5 py-8">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="text-[13px]">Loading repositories...</span>
            </div>
          ) : githubRepos?.groups ? (
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Your Repositories</h4>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {githubRepos.groups.slice(0, 2).map((group) =>
                  group.repositories.slice(0, 5).map((repo) => (
                    <div
                      key={repo.id}
                      className="flex items-center justify-between p-2 border rounded hover:bg-accent"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{repo.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{repo.full_name}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        asChild
                        className="ml-2"
                      >
                        <Link
                          href={`https://github.com/${repo.full_name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <Link
            href={`https://github.com/settings/installations/${githubStatus?.installationId}`}
            target="_blank"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <Image src="/github.svg" alt="GitHub" width={16} height={16} />
            <span>Manage GitHub Connection</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          size="iconSm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
        >
          <Settings />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="user" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              User Info
            </TabsTrigger>
            <TabsTrigger value="models" className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Models
            </TabsTrigger>
            <TabsTrigger value="github" className="flex items-center gap-2">
              <Github className="h-4 w-4" />
              GitHub
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="user" className="mt-6">
            <UserInfoTab />
          </TabsContent>
          
          <TabsContent value="models" className="mt-6">
            <ModelsTab />
          </TabsContent>
          
          <TabsContent value="github" className="mt-6">
            <GitHubTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Create a wrapper that allows opening with a specific tab
export function SettingsDialog() {
  return <SettingsModal />;
}

// Export a version that can be controlled externally
export function openSettingsModal(tab?: string) {
  // This will be used by the model selector to open the modal to the models tab
  const event = new CustomEvent('open-settings-modal', { detail: { tab } });
  window.dispatchEvent(event);
}