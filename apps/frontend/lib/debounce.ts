import { useCallback, useRef } from "react";

/**
 * Creates a debounced version of the provided function that delays invoking until after
 * the specified delay has elapsed since the last time the debounced function was invoked.
 *
 * @param callback - The function to debounce
 * @param delay - The number of milliseconds to delay
 * @returns A debounced version of the callback function
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebounceCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  return useCallback(
    ((...args: Parameters<T>) => {
      // Clear the previous timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set a new timeout
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    }) as T,
    [callback, delay]
  );
}

/**
 * Creates a function that can be used to cancel pending debounced calls
 *
 * @param callback - The function to debounce
 * @param delay - The number of milliseconds to delay
 * @returns An object with the debounced function and a cancel method
 */
export function useDebounceCallbackWithCancel<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends (...args: any[]) => any,
>(callback: T, delay: number): { debouncedCallback: T; cancel: () => void } {
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  const debouncedCallback = useCallback(
    ((...args: Parameters<T>) => {
      cancel();
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    }) as T,
    [callback, delay, cancel]
  );

  return { debouncedCallback, cancel };
}
