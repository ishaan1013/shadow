"use client";

import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)}>
      <ReactMarkdown
        components={{
          // Customize heading styles to match the theme
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0 text-foreground">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold mb-3 mt-5 text-foreground">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-medium mb-2 mt-4 text-foreground">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-medium mb-2 mt-3 text-foreground">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-medium mb-2 mt-3 text-foreground">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-sm font-medium mb-2 mt-3 text-muted-foreground">
              {children}
            </h6>
          ),
          // Style paragraphs
          p: ({ children }) => (
            <p className="mb-4 text-foreground leading-relaxed">{children}</p>
          ),
          // Style code blocks
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code: ({ inline, children, ...props }: any) => {
            const isInline = inline ?? !props.className;
            if (isInline) {
              return (
                <code
                className="bg-muted text-muted-foreground px-1 py-0.5 rounded font-mono text-sm inline"
                {...props}
              >
                {children}
              </code>
              );
            }
            return (
              <code
                className="block bg-muted text-muted-foreground p-3 rounded-md text-sm font-mono overflow-x-auto"
                {...props}
              >
                {children}
              </code>
            );
          },
          // Style pre blocks
          pre: ({ children }) => (
            <pre className="bg-muted text-muted-foreground p-3 rounded-md text-sm font-mono overflow-x-auto mb-4">
              {children}
            </pre>
          ),
          // Style blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-border pl-4 italic text-muted-foreground mb-4">
              {children}
            </blockquote>
          ),
          // Style lists
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-4 space-y-1 text-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-4 space-y-1 text-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-foreground leading-relaxed">{children}</li>
          ),
          // Style links
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-primary hover:text-primary/80 underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          // Style tables
          table: ({ children }) => (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full border-collapse border border-border">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted px-3 py-2 text-left font-medium text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-2 text-foreground">
              {children}
            </td>
          ),
          // Style horizontal rules
          hr: () => <hr className="border-border my-6" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
