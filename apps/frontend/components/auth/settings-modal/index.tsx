"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useModal } from "@/components/layout/modal-context";
import { Box, User2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import { GithubLogo } from "../../logo/github-logo";
import { UserSettings } from "./user-settings";
import { ModelSettings } from "./model-settings";
import { GitHubSettings } from "./github-settings";

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

export function SettingsModal() {
  const {
    isSettingsModalOpen,
    settingsModalTab,
    closeSettingsModal,
    setSettingsModalTab,
    openSettingsModal,
  } = useModal();

  const activeTab = settingsModalTab;
  const currentTab = tabs.find((tab) => tab.value === activeTab);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openSettingsModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openSettingsModal]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "user":
        return <UserSettings />;
      case "models":
        return <ModelSettings />;
      case "github":
        return <GitHubSettings />;
      default:
        return <UserSettings />;
    }
  };

  return (
    <Dialog open={isSettingsModalOpen} onOpenChange={closeSettingsModal}>
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
                  onClick={() =>
                    setSettingsModalTab(
                      tab.value as "user" | "models" | "github"
                    )
                  }
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
              {renderTabContent()}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
