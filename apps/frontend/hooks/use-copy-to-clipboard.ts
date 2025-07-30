import { useState, useCallback } from "react";

export function useCopyToClipboard() {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);

      // Reset after 3 seconds
      setTimeout(() => {
        setIsCopied(false);
      }, 3000);

      return true;
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      return false;
    }
  }, []);

  return { copyToClipboard, isCopied };
}
