"use client";

import { LogoHover } from "@/components/logo/logo-hover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinWaitlist } from "@/lib/actions/joinWaitlist";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

export default function HomeContent({
  joinedWaitlist = false,
}: {
  joinedWaitlist: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const [email, setEmail] = useState("");

  const handleJoinWaitlist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || joinedWaitlist) {
      return;
    }

    try {
      setIsLoading(true);
      await joinWaitlist(email);
      toast.success("You're on the waitlist!");
    } catch (_error: unknown) {
      toast.error("Failed to join waitlist");
    } finally {
      setIsLoading(false);
      setEmail("");
    }
  };

  return (
    <div className="size-full select-none font-sans">
      <div className="mx-auto flex size-full max-w-md flex-col items-center justify-center gap-12 p-4">
        <div className="font-departureMono flex items-center gap-4 text-3xl font-medium tracking-tighter">
          <LogoHover size="lg" forceAnimate />
          <span className="hidden sm:block">Code with</span>
          <span className="sm:text-muted-foreground inline-flex items-center gap-2">
            Shadow
          </span>
        </div>

        <div className="text-muted-foreground flex flex-col gap-4">
          <div className="text-pretty text-center">
            An open-source background agent with subagents, a context engine,
            and a real-time interface.
          </div>

          <div className="text-pretty text-center">
            For long-running, parallel coding tasks.
          </div>

          <div className="text-pretty text-center">Launching early August.</div>
        </div>

        {joinedWaitlist ? (
          <div className="border-border from-card to-card/10 flex h-12 items-center justify-center text-pretty rounded-lg border bg-gradient-to-b px-6 text-center">
            You're on the waitlist!
          </div>
        ) : (
          <form
            className="flex h-12 w-full select-text flex-col items-center gap-2 sm:flex-row"
            onSubmit={handleJoinWaitlist}
          >
            <Input
              placeholder="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="text-sm! sm:flex-1"
            />
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={isLoading || !email.trim()}
              size="lg"
            >
              Join Waitlist
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
