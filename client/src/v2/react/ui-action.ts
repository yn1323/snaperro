import { toaster } from "../../components/ui/toaster";

export async function runUiAction(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    toaster.error({
      title: "Error",
      description: error instanceof Error ? error.message : fallback,
      duration: 5_000,
    });
    return false;
  }
}
