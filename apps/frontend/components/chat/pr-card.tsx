import { Card } from "@/components/ui/card";
import { Circle, File } from "lucide-react";
import Link from "next/link";
import { PullRequestSnapshot } from "@repo/db";
import { useTask } from "@/hooks/use-task";
import Image from "next/image";
import { MarkdownRenderer } from "../agent-environment/markdown-renderer";

export function PRCard({
  taskId,
  snapshot,
}: {
  taskId: string;
  snapshot: PullRequestSnapshot;
}) {
  const { task } = useTask(taskId);

  const prUrl = `${task?.repoUrl}/pull/${task?.pullRequestNumber}`;

  return (
    <>
      <Link href={prUrl} target="_blank">
        <Card className="hover:bg-card/70 mt-4 gap-1 rounded-lg p-3 text-left">
          <div className="flex items-center gap-2 overflow-hidden font-medium">
            <Image src="/github.svg" alt="GitHub" width={16} height={16} />
            <span className="truncate">{snapshot.title}</span>
          </div>

          <div className="text-muted-foreground flex items-center gap-2 text-[13px]">
            <div>#{task?.pullRequestNumber}</div>

            <Circle className="fill-muted-foreground size-1 opacity-50" />

            <div className="flex items-center gap-1">
              <span className="text-green-400">+{snapshot.linesAdded}</span>
              <span className="text-red-400">-{snapshot.linesRemoved}</span>
            </div>

            <Circle className="fill-muted-foreground size-1 opacity-50" />

            <div className="flex items-center gap-1">
              <File className="size-3" />
              <span>
                {snapshot.filesChanged} file
                {snapshot.filesChanged !== 1 ? "s" : ""}
              </span>
            </div>

            <Circle className="fill-muted-foreground size-1 opacity-50" />

            <div>{snapshot.commitSha.slice(0, 7)}</div>
          </div>
        </Card>
      </Link>

      <div className="mt-3 p-3">
        <MarkdownRenderer
          content={`# Summary\n\n${snapshot.description}`}
          componentProps={{
            p: "m-0 whitespace-pre-wrap",
          }}
        ></MarkdownRenderer>
      </div>
    </>
  );
}
