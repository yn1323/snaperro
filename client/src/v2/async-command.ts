export interface AsyncError {
  name: string;
  message: string;
  code?: string;
}

export function toAsyncError(error: unknown): AsyncError {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return { name: error.name, message: error.message, ...(code ? { code } : {}) };
  }
  if (typeof error === "string") return { name: "Error", message: error };
  return { name: "Error", message: "Unknown error" };
}

export type AsyncCommandStatus = "idle" | "pending" | "success" | "error";

export interface AsyncCommandState<TResult> {
  status: AsyncCommandStatus;
  executionId: number | null;
  result: TResult | null;
  error: AsyncError | null;
}

export type AsyncCommandAction<TResult> =
  | { type: "started"; executionId: number }
  | { type: "succeeded"; executionId: number; result: TResult }
  | { type: "failed"; executionId: number; error: unknown }
  | { type: "reset" };

export function createAsyncCommandState<TResult>(): AsyncCommandState<TResult> {
  return { status: "idle", executionId: null, result: null, error: null };
}

export function reduceAsyncCommand<TResult>(
  state: AsyncCommandState<TResult>,
  action: AsyncCommandAction<TResult>,
): AsyncCommandState<TResult> {
  switch (action.type) {
    case "started":
      return {
        status: "pending",
        executionId: action.executionId,
        result: null,
        error: null,
      };
    case "succeeded":
      if (state.status !== "pending" || state.executionId !== action.executionId) return state;
      return {
        status: "success",
        executionId: action.executionId,
        result: action.result,
        error: null,
      };
    case "failed":
      if (state.status !== "pending" || state.executionId !== action.executionId) return state;
      return {
        status: "error",
        executionId: action.executionId,
        result: null,
        error: toAsyncError(action.error),
      };
    case "reset":
      return createAsyncCommandState<TResult>();
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
