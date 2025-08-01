"use client";

import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface ComponentClassNames {
  wrapper?: string;
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
  h5?: string;
  h6?: string;
  p?: string;
  code?: string;
  inlineCode?: string;
  pre?: string;
  blockquote?: string;
  ul?: string;
  ol?: string;
  li?: string;
  a?: string;
  table?: string;
  tableWrapper?: string;
  th?: string;
  td?: string;
  hr?: string;
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  componentProps?: ComponentClassNames;
}

export function MarkdownRenderer({
  content,
  className,
  componentProps,
}: MarkdownRendererProps) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        className,
        componentProps?.wrapper
      )}
    >
      <ReactMarkdown
        components={{
          // Customize heading styles to match the theme
          h1: ({ children }) => (
            <h1
              className={cn(
                "text-foreground mb-4 mt-6 text-[22px] font-medium first:mt-0",
                componentProps?.h1
              )}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className={cn(
                "text-foreground mb-3 mt-5 text-xl font-medium",
                componentProps?.h2
              )}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className={cn(
                "text-foreground mb-2 mt-4 text-lg font-medium",
                componentProps?.h3
              )}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4
              className={cn(
                "text-foreground mb-2 mt-3 text-base font-medium",
                componentProps?.h4
              )}
            >
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5
              className={cn(
                "text-foreground mb-2 mt-3 text-sm font-medium",
                componentProps?.h5
              )}
            >
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6
              className={cn(
                "text-muted-foreground mb-2 mt-3 text-sm font-medium",
                componentProps?.h6
              )}
            >
              {children}
            </h6>
          ),
          // Style paragraphs
          p: ({ children }) => (
            <p
              className={cn(
                "text-foreground mb-4 leading-relaxed",
                componentProps?.p
              )}
            >
              {children}
            </p>
          ),
          // Style code blocks
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code: ({ inline, children, ...props }: any) => {
            const isInline = inline ?? !props.className;
            if (isInline) {
              return (
                <code
                  className={cn(
                    "bg-muted text-muted-foreground inline rounded px-1 py-0.5 font-mono text-sm",
                    componentProps?.inlineCode
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn(
                  "bg-muted text-muted-foreground block overflow-x-auto rounded-md p-3 font-mono text-sm",
                  componentProps?.code
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
          // Style pre blocks
          pre: ({ children }) => (
            <pre
              className={cn(
                "bg-muted text-muted-foreground mb-4 overflow-x-auto rounded-md p-3 font-mono text-sm",
                componentProps?.pre
              )}
            >
              {children}
            </pre>
          ),
          // Style blockquotes
          blockquote: ({ children }) => (
            <blockquote
              className={cn(
                "border-border text-muted-foreground mb-4 border-l-4 pl-4 italic",
                componentProps?.blockquote
              )}
            >
              {children}
            </blockquote>
          ),
          // Style lists
          ul: ({ children }) => (
            <ul
              className={cn(
                "text-foreground mb-4 list-inside list-disc space-y-1",
                componentProps?.ul
              )}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className={cn(
                "text-foreground mb-4 list-inside list-decimal space-y-1",
                componentProps?.ol
              )}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li
              className={cn(
                "text-foreground leading-relaxed",
                componentProps?.li
              )}
            >
              {children}
            </li>
          ),
          // Style links
          a: ({ children, href }) => (
            <a
              href={href}
              className={cn(
                "text-primary hover:text-primary/80 underline underline-offset-2",
                componentProps?.a
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          // Style tables
          table: ({ children }) => (
            <div
              className={cn(
                "mb-4 overflow-x-auto",
                componentProps?.tableWrapper
              )}
            >
              <table
                className={cn(
                  "border-border min-w-full border-collapse border",
                  componentProps?.table
                )}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              className={cn(
                "border-border bg-muted text-foreground border px-3 py-2 text-left font-medium",
                componentProps?.th
              )}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className={cn(
                "border-border text-foreground border px-3 py-2",
                componentProps?.td
              )}
            >
              {children}
            </td>
          ),
          // Style horizontal rules
          hr: () => (
            <hr className={cn("border-border my-6", componentProps?.hr)} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
