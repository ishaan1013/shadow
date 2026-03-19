import { LuckyRandomPanel } from "@/components/random/lucky-random-panel";
import { HomeLayoutWrapper } from "@/components/layout/home-layout";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Random | Shadow",
  description: "A small demo page with a random number and phrase.",
};

export default function RandomPage() {
  return (
    <HomeLayoutWrapper>
      <LuckyRandomPanel />
    </HomeLayoutWrapper>
  );
}
