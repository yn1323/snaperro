import { consola } from "consola";
import open from "open";

interface DemoOptions {
  port?: string;
}

/**
 * demo command
 * Open demo page in browser (requires server to be running)
 */
export async function demoCommand(options: DemoOptions): Promise<void> {
  const port = options.port ? Number.parseInt(options.port, 10) : 3333;
  const demoUrl = `http://localhost:${port}/__snaperro__/demo`;

  try {
    // Check if server is running by fetching the mode endpoint
    const response = await fetch(`http://localhost:${port}/__snaperro__/mode`);
    if (!response.ok) {
      throw new Error("Server not responding");
    }

    consola.success(`Opening demo page: ${demoUrl}`);
    await open(demoUrl);
  } catch {
    consola.error(`Server is not running on port ${port}`);
    consola.info("Start the server first with: npx snaperro start");
    process.exit(1);
  }
}
