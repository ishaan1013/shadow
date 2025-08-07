"use client";

import { useState, useEffect } from "react";
import { useAuthSession } from "@/components/auth/session-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, Github, Key, Shield, X } from "lucide-react";

export const WELCOME_MODAL_STORAGE_KEY = "shadow-welcome-modal-shown";

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  const handleClose = () => {
    // Mark as shown in localStorage
    if (typeof window !== "undefined") {
      localStorage.setItem(WELCOME_MODAL_STORAGE_KEY, "true");
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold text-center mb-2">
            Welcome to Shadow! 🎉
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-6 text-left">
              <p className="text-base text-center text-muted-foreground">
                Let's get you set up for the best coding experience.
              </p>
              
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <Github className="size-6 text-blue-600 mt-1 shrink-0" />
                  <div className="space-y-2">
                    <h3 className="font-medium text-foreground">
                      1. Connect the Shadow GitHub App
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Connect your GitHub repositories to enable Shadow to read your code, 
                      create branches, and submit pull requests on your behalf.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <Key className="size-6 text-green-600 mt-1 shrink-0" />
                  <div className="space-y-2">
                    <h3 className="font-medium text-foreground">
                      2. Add Your Model API Keys
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Add your OpenAI, Anthropic, or OpenRouter API keys to unlock Shadow's 
                      full potential. You can configure these in your settings.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 border rounded-lg bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
                  <Shield className="size-6 text-amber-600 mt-1 shrink-0" />
                  <div className="space-y-2">
                    <h3 className="font-medium text-foreground">
                      Security & Privacy Notice
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Your data is stored securely and encrypted. However, for maximum security, 
                      we recommend avoiding work on highly confidential or sensitive codebases 
                      in Shadow.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground pt-4 border-t">
                <CheckCircle className="size-4 text-green-600" />
                <span>You can access these settings anytime from the user menu</span>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex justify-end pt-6">
          <Button onClick={handleClose} className="min-w-32">
            Let's get started!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Hook to manage welcome modal state
export function useWelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const { session, isLoading } = useAuthSession();

  useEffect(() => {
    // Only show modal if user is authenticated and not loading
    if (!isLoading && session && typeof window !== "undefined") {
      const hasShown = localStorage.getItem(WELCOME_MODAL_STORAGE_KEY);
      if (!hasShown) {
        // Add a small delay to ensure the page has loaded
        const timer = setTimeout(() => {
          setIsOpen(true);
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [isLoading, session]);

  const closeModal = () => {
    setIsOpen(false);
  };

  return {
    isOpen,
    closeModal,
  };
}