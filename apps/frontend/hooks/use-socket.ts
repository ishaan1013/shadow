"use client";

import { useEffect, useState } from "react";
import { socket } from "../lib/socket";

/**
 * A simple hook that wraps the existing socket implementation
 * and provides connection state management
 */
export function useSocket() {
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    // Connect socket if not connected
    if (!socket.connected) {
      socket.connect();
    }

    // Handle connection events
    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    // Register event handlers
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    // Set initial state
    setIsConnected(socket.connected);

    // Cleanup
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // Return the socket instance and connection state
  return socket;
}
