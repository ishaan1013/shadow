"use client";

import { useTask } from "@/hooks/use-task";
import { cn } from "@/lib/utils";
import { getStepsForMode, STEP_DISPLAY_NAMES } from "@repo/types";
import { Check } from "lucide-react";
import { LogoHover } from "../logo/logo-hover";
import { useEffect, useState } from "react";

// height of each step
const LINE_HEIGHT = 20;
const GAP = 8;
// extra padding to hide stream if its too fast
const BOTTOM_PADDING = 150;

export default function InitializingAnimation({ taskId }: { taskId: string }) {
  const { task } = useTask(taskId);

  if (!task) {
    return null;
  }

  const mode =
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
      ? "remote"
      : "local";

  const steps = getStepsForMode(mode);

  const initStatus = task.initStatus;
  let currentStepIndex = 0;
  
  if (initStatus === 'ACTIVE') {
    currentStepIndex = steps.length; // All steps completed
  } else if (initStatus && initStatus !== 'INACTIVE') {
    const stepIndex = steps.findIndex((step) => step === initStatus);
    currentStepIndex = stepIndex >= 0 ? stepIndex + 1 : 0;
  }

  return (
    <div
      className={cn(
        "font-departureMono bg-background top-18 pointer-events-none absolute z-20 flex w-full select-none flex-col gap-1 px-3 tracking-tight transition-all duration-1000 ease-in-out",
        currentStepIndex === steps.length
          ? "invisible opacity-0"
          : "visible opacity-100"
      )}
      style={{
        paddingBottom: `${BOTTOM_PADDING}px`,
      }}
    >
      <AnimationHeader />
      <div className="relative z-0 flex h-20 w-full overflow-hidden pt-7">
        <div className="from-background via-background/60 absolute left-0 top-0 z-10 h-6 w-full bg-gradient-to-b to-transparent" />

        <div
          className="flex flex-col gap-2 transition-transform duration-1000 ease-in-out"
          style={{
            transform: `translateY(-${currentStepIndex * (LINE_HEIGHT + GAP)}px)`,
          }}
        >
          {steps.map((step, index) => (
            <div
              key={index}
              className={cn(
                "flex items-center capitalize transition-colors",
                index !== currentStepIndex
                  ? "text-muted-foreground/50"
                  : "text-foreground"
              )}
              style={{
                gap: `${GAP}px`,
                height: `${LINE_HEIGHT}px`,
              }}
            >
              {index < currentStepIndex ? (
                <div className="size-4 shrink-0">
                  <Check className="size-4" />
                </div>
              ) : (
                <LogoHover
                  forceAnimate={index === currentStepIndex}
                  size="sm"
                />
              )}
              {STEP_DISPLAY_NAMES[step]}
            </div>
          ))}
        </div>

        <div className="from-background via-background/60 absolute bottom-0 left-0 z-10 h-6 w-full bg-gradient-to-t  to-transparent" />
      </div>
    </div>
  );
}

function AnimationHeader() {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((dots) => (dots % 3) + 1);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-muted-foreground text-[13px]">
      Initializing Shadow
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i}>.</span>
      ))}
    </div>
  );
}
