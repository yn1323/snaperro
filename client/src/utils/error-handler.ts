import { toaster } from "../components/ui/toaster";

/**
 * Execute an async function with error handling
 * Shows a toast notification on error
 * @param fn - The async function to execute
 * @param errorMessage - The message to show on error
 * @returns The result of the function, or undefined if an error occurred
 */
export async function withErrorHandling<T>(fn: () => Promise<T>, errorMessage: string): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error(errorMessage, err);
    toaster.error({
      title: "Error",
      description: err instanceof Error ? err.message : errorMessage,
      duration: 5000,
    });
    return undefined;
  }
}

/**
 * Create a safe handler wrapper that catches errors and shows toast notifications
 * @param fn - The async function to wrap
 * @param errorMessage - The message to show on error
 * @returns A wrapped function that handles errors
 */
export function createSafeHandler<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  errorMessage: string,
): (...args: Args) => Promise<T | undefined> {
  return async (...args: Args): Promise<T | undefined> => {
    return withErrorHandling(() => fn(...args), errorMessage);
  };
}
