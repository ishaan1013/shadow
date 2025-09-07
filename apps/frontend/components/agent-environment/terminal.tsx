"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { useEffect, useRef, memo, useCallback } from "react";
import { useTerminalSocket } from "@/hooks/socket";
import { useParams } from "next/navigation";
import type { TerminalEntry } from "@repo/types";
import { useAgentEnvironment } from "./agent-environment-context";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

function TerminalComponent({ handleCollapse }: { handleCollapse: () => void }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isFirstRender = useRef(true);

  const params = useParams();
  const taskId = params?.taskId as string;

  // Use our hook architecture but with enhanced terminal functionality
  const { terminalEntries, clearTerminal: _clearTerminal } =
    useTerminalSocket(taskId);

  // Get terminal resize trigger from context
  const { terminalResizeTrigger } = useAgentEnvironment();

  // Terminal entry formatting with ANSI colors
  const writeToTerminal = useCallback((entry: TerminalEntry) => {
    const xterm = xtermRef.current;
    if (!xterm) return;

    switch (entry.type) {
      case "command":
        // Gray for commands
        xterm.write(`\x1b[90m$ ${entry.data}\x1b[0m\r\n`);
        break;
      case "stdout":
        // Normal white text for stdout
        xterm.write(entry.data + "\r\n");
        break;
      case "stderr":
        // Red text for errors
        xterm.write(`\x1b[31m${entry.data}\x1b[0m`);
        break;
      case "system":
        // Gray text for system messages
        xterm.write(`\x1b[90m${entry.data}\x1b[0m\r\n`);
        break;
      default:
        xterm.write(entry.data);
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create xterm instance
    const xterm = new XTerm({
      fontFamily: '"Geist Mono", "Fira Code", "Courier New", monospace',
      fontSize: 13,
      fontWeight: 400,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      theme: {
        background: "#101010",
        foreground: "#ffffff",
        cursor: "#ffffff",
        cursorAccent: "#101010",
        black: "#101010",
        red: "#ff5555",
        green: "#50fa7b",
        yellow: "#f1fa8c",
        blue: "#bd93f9",
        magenta: "#ff79c6",
        cyan: "#8be9fd",
        white: "#f8f8f2",
        brightBlack: "#A1A1A1",
        brightRed: "#ff5555",
        brightGreen: "#50fa7b",
        brightYellow: "#f1fa8c",
        brightBlue: "#bd93f9",
        brightMagenta: "#ff79c6",
        brightCyan: "#8be9fd",
        brightWhite: "#e5e5e5",
      },
      allowProposedApi: true,
      disableStdin: true, // Read-only terminal
    });

    // Create fit addon
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    // Open terminal
    xterm.open(terminalRef.current);

    // Store references
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Write initial welcome message
    xterm.writeln("\x1b[1m=== Shadow Agent Terminal ===\x1b[0m");
    xterm.writeln("");

    // Handle terminal resize
    const handleResize = () => {
      if (fitAddon) {
        fitAddon.fit();
      }
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Handle panel resize triggers from context
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (fitAddonRef.current) {
      fitAddonRef.current.fit();
    }
  }, [terminalResizeTrigger]);

  // Write terminal entries to xterm when they change
  useEffect(() => {
    if (xtermRef.current && terminalEntries.length > 0) {
      // Clear and rewrite all entries
      xtermRef.current.clear();
      xtermRef.current.writeln("Shadow Agent Terminal");
      xtermRef.current.writeln("Connected to agent workspace");
      xtermRef.current.writeln("");

      terminalEntries.forEach((entry) => writeToTerminal(entry));
    }
  }, [terminalEntries, writeToTerminal]);

  return (
    <div className="bg-background relative flex-1 overflow-hidden">
      {/* Connection status indicator */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="iconXs"
            className="text-muted-foreground hover:text-foreground absolute right-1.5 top-1.5 z-10"
            onClick={handleCollapse}
          >
            <ChevronDown />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          Collapse Terminal
        </TooltipContent>
      </Tooltip>

      <div ref={terminalRef} className="hide-scrollbar h-full" />
    </div>
  );
}

const Terminal = memo(TerminalComponent, (prevProps, nextProps) => {
  return prevProps.handleCollapse === nextProps.handleCollapse;
});

export default Terminal;
