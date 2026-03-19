"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dices } from "lucide-react";
import { useState } from "react";

const PHRASES = [
  "Small steps beat big plans.",
  "Refactor when it hurts, not when it's trendy.",
  "The best code is code you can delete later.",
  "Read the error message twice.",
  "One failing test is a compass.",
  "Naming is cheaper than comments.",
  "Ship it, then make it true.",
];

export function LuckyRandomPanel() {
  const [roll, setRoll] = useState<{
    n: number;
    phrase: string;
  } | null>(null);

  const handleRoll = () => {
    setRoll({
      n: Math.floor(Math.random() * 100) + 1,
      phrase: PHRASES[Math.floor(Math.random() * PHRASES.length)]!,
    });
  };

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-8 p-6">
      <Card className="border-border/80 w-full max-w-md shadow-md">
        <CardHeader>
          <CardTitle className="font-departureMono text-lg tracking-tight">
            Random corner
          </CardTitle>
          <CardDescription>
            A throwaway page: roll a number and a line of pseudo-wisdom.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Lucky number
            </p>
            <p className="font-departureMono text-4xl tabular-nums">
              {roll ? roll.n : "—"}
            </p>
          </div>
          <blockquote className="text-muted-foreground border-border border-l-2 pl-4 text-sm leading-relaxed">
            {roll ? roll.phrase : "Press the button to conjure something."}
          </blockquote>
          <Button
            type="button"
            onClick={handleRoll}
            className="w-full sm:w-auto"
          >
            <Dices className="size-4" />
            Roll again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
