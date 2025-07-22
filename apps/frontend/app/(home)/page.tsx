import { PromptForm } from "@/components/chat/prompt-form";
import { HomeLayoutWrapper } from "@/components/layout/home-layout";
import { getUser } from "@/lib/auth/get-user";
import {
  getGitHubRepositories,
  getGitHubStatus,
} from "@/lib/github/github-api";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";

export default async function Home() {
  const user = await getUser();
  const queryClient = new QueryClient();

  // Prefetch GitHub data for better UX - each prefetch is independent
  // and failures won't break the page render
  const prefetchPromises = [
    queryClient
      .prefetchQuery({
        queryKey: ["github", "status"],
        queryFn: () => getGitHubStatus(user?.id),
      })
      .catch((error) => {
        console.log(
          "Could not prefetch GitHub status:",
          error?.message || error
        );
      }),
    queryClient
      .prefetchQuery({
        queryKey: ["github", "repositories"],
        queryFn: () => getGitHubRepositories(user?.id),
      })
      .catch((error) => {
        console.log(
          "Could not prefetch GitHub repositories:",
          error?.message || error
        );
      }),
  ];

  // Wait for all prefetch attempts to complete (success or failure)
  await Promise.allSettled(prefetchPromises);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomeLayoutWrapper>
        <div className="mx-auto flex size-full max-w-lg flex-col items-center mt-24 gap-8">
          <div className="text-2xl font-medium">Shadow</div>
          <PromptForm isHome />
        </div>
      </HomeLayoutWrapper>
    </HydrationBoundary>
  );
}
