import HomeContent from "@/components/home";
import { cookies } from "next/headers";

export default async function Home() {
  const cookieStore = await cookies();
  const joinedWaitlist = cookieStore.get("joined-waitlist")?.value === "true";

  return <HomeContent joinedWaitlist={joinedWaitlist} />;
}
