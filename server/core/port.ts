import net from "node:net";

/**
 * Check if specified port is available
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port);
  });
}

/**
 * Find available port (max maxAttempts attempts)
 * @param startPort Starting port number
 * @param maxAttempts Maximum number of attempts (default: 10)
 * @returns Available port number
 * @throws When all ports are in use
 */
export async function findAvailablePort(startPort: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`Ports ${startPort}-${startPort + maxAttempts - 1} are all in use`);
}
