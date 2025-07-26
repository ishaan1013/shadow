"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useTerminalSocket } from "@/hooks/socket";
import { useParams } from "next/navigation";
import type { TerminalEntry } from "@repo/types";

export default function Terminal() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const params = useParams();
  const taskId = params?.taskId as string;

  // Use our hook architecture but with enhanced terminal functionality
  const { terminalEntries, isTerminalConnected, clearTerminal } =
    useTerminalSocket(taskId);

  // Terminal entry formatting with ANSI colors
  const writeToTerminal = (entry: TerminalEntry) => {
    const xterm = xtermRef.current;
    if (!xterm) return;

    switch (entry.type) {
      case "command":
        // Green bold for commands
        xterm.write(`\x1b[1;32m$ ${entry.data}\x1b[0m\r\n`);
        break;
      case "stdout":
        // Normal white text for stdout
        xterm.write(entry.data);
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
  };

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create xterm instance
    const xterm = new XTerm({
      fontFamily: '"Departure Mono", "Fira Code", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      theme: {
        background: "#0a0a0a",
        foreground: "#ffffff",
        cursor: "#ffffff",
        cursorAccent: "#0a0a0a",
        black: "#0a0a0a",
        red: "#ff5555",
        green: "#50fa7b",
        yellow: "#f1fa8c",
        blue: "#bd93f9",
        magenta: "#ff79c6",
        cyan: "#8be9fd",
        white: "#f8f8f2",
        brightBlack: "#44475a",
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
  }, [terminalEntries]);

  return (
    <div className="bg-background relative flex-1 overflow-hidden p-2">
      {/* Connection status indicator */}
      <div className="absolute right-4 top-4 z-10">
        <div
          className={`h-2 w-2 rounded-full ${isTerminalConnected ? "bg-green-500" : "bg-red-500"}`}
          title={isTerminalConnected ? "Connected" : "Disconnected"}
        />
      </div>

      <div ref={terminalRef} className="h-full" />
    </div>
  );
}
