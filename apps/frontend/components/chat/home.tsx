"use client";

import { useState } from "react";
import { LogoHover } from "../logo/logo-hover";
import { PromptForm } from "./prompt-form";
import type { FilteredRepository } from "@/lib/github/types";

export function HomePageContent({
  initialGitCookieState,
}: {
  initialGitCookieState?: {
    repo: FilteredRepository | null;
    branch: { name: string; commitSha: string } | null;
  } | null;
}) {
  const [isFocused, setIsFocused] = useState(true);

  return (
    <div className="mx-auto mt-24 flex size-full max-w-lg flex-col items-center gap-8">
      <div className="font-departureMono flex items-center gap-4 text-3xl font-medium tracking-tighter">
        <LogoHover size="lg" forceAnimate={isFocused} />
        Code with{" "}
        <span className="text-muted-foreground inline-flex items-center gap-2">
          Shadow
        </span>
      </div>
      <PromptForm
        isHome
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        initialGitCookieState={initialGitCookieState}
      />
    </div>
  );
}
