import { marked } from "marked";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { ShikiCode } from "@/components/ui/shiki-code";

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

const MemoizedMarkdownBlock = memo(
  ({ content }: { content: string }) => {
    return (
      <div className="prose text-foreground prose-headings:font-medium prose-h1:text-2xl prose-sm prose-invert prose-neutral prose-ul:list-disc prose-ol:list-decimal prose-li:marker:text-muted-foreground prose-code:rounded-sm prose-code:border prose-code:bg-card prose-code:px-1 prose-code:before:content-none prose-code:after:content-none prose-code:font-normal prose-pre:p-0 prose-pre:bg-background max-w-none">
        <ReactMarkdown
          components={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            code: ({ inline, children, className, ...props }: any) => {
              const isInline = inline ?? !className;
              return (
                <ShikiCode
                  inline={isInline}
                  {...(className && { className })}
                  {...props}
                >
                  {String(children).replace(/\n$/, "")}
                </ShikiCode>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.content !== nextProps.content) return false;
    return true;
  }
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

export const MemoizedMarkdown = memo(
  ({ content, id }: { content: string; id: string }) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

    return (
      <div className="space-y-2">
        {blocks.map((block, index) => (
          <MemoizedMarkdownBlock content={block} key={`${id}-block_${index}`} />
        ))}
      </div>
    );
  }
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";

export function FadedMarkdown({
  content,
  id,
}: {
  content: string;
  id: string;
}) {
  return (
    <div className="relative z-0 max-h-96 overflow-hidden opacity-70">
      <div className="from-background absolute -bottom-px left-0 z-10 h-24 w-full bg-gradient-to-t to-transparent" />
      <MemoizedMarkdown content={content} id={id} />
    </div>
  );
}
