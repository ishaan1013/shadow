"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import "./logo-animation.css";
import { ShadowLogoSvg } from "./logo-svg";
import { ShadowLogoHoverSvg } from "./logo-hover-svg";

const sizes = {
  sm: {
    width: 16,
    animateWidth: 240,
    height: 16,
    className: "logo-sm",
  },
  md: {
    width: 20,
    animateWidth: 300,
    height: 20,
    className: "logo-md",
  },
  lg: {
    width: 25,
    animateWidth: 375,
    height: 25,
    className: "logo-lg",
  },
};

export function LogoHover({
  forceAnimate,
  size = "md",
  className,
}: {
  forceAnimate?: boolean;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const [isAnimating, setIsAnimating] = useState(false);

  const shouldAnimate = forceAnimate !== undefined ? forceAnimate : isAnimating;

  return (
    <div
      className={cn("overflow-hidden", className)}
      style={{ width: sizes[size].width, height: sizes[size].height }}
      onMouseEnter={() => {
        if (forceAnimate === undefined) {
          setIsAnimating(true);
        }
      }}
      onMouseLeave={() => {
        if (forceAnimate === undefined) {
          setIsAnimating(false);
        }
      }}
    >
      <div
        style={{
          width: shouldAnimate ? sizes[size].animateWidth : sizes[size].width,
          height: sizes[size].height,
        }}
      >
        {shouldAnimate ? (
          <ShadowLogoHoverSvg className={sizes[size].className} />
        ) : (
          <ShadowLogoSvg className={sizes[size].className} />
        )}
      </div>
    </div>
  );
}
