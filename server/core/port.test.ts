import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findAvailablePort, isPortAvailable } from "./port.js";

describe("isPortAvailable", () => {
  let server: net.Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it("returns true for available port", async () => {
    const result = await isPortAvailable(19999);
    expect(result).toBe(true);
  });

  it("returns false for port in use", async () => {
    // Start a server on the port
    server = net.createServer();
    await new Promise<void>((resolve) => {
      if (server) server.listen(19998, () => resolve());
    });

    const result = await isPortAvailable(19998);
    expect(result).toBe(false);
  });
});

describe("findAvailablePort", () => {
  const servers: net.Server[] = [];

  beforeEach(() => {
    servers.length = 0;
  });

  afterEach(() => {
    for (const server of servers) {
      server.close();
    }
    servers.length = 0;
  });

  it("returns start port if available", async () => {
    const port = await findAvailablePort(19990);
    expect(port).toBe(19990);
  });

  it("finds next available port when start port is in use", async () => {
    // Occupy the first port
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(19991, () => resolve());
    });

    const port = await findAvailablePort(19991);
    expect(port).toBe(19992);
  });

  it("finds available port skipping multiple occupied ports", async () => {
    // Occupy first 3 ports
    for (let i = 0; i < 3; i++) {
      const server = net.createServer();
      servers.push(server);
      await new Promise<void>((resolve) => {
        server.listen(19980 + i, () => resolve());
      });
    }

    const port = await findAvailablePort(19980);
    expect(port).toBe(19983);
  });

  it("throws error when all ports in range are in use", async () => {
    // Occupy 3 ports with maxAttempts = 3
    for (let i = 0; i < 3; i++) {
      const server = net.createServer();
      servers.push(server);
      await new Promise<void>((resolve) => {
        server.listen(19970 + i, () => resolve());
      });
    }

    await expect(findAvailablePort(19970, 3)).rejects.toThrow("Ports 19970-19972 are all in use");
  });

  it("respects maxAttempts parameter", async () => {
    // Only try 1 port
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(19960, () => resolve());
    });

    await expect(findAvailablePort(19960, 1)).rejects.toThrow("Ports 19960-19960 are all in use");
  });

  it("uses default maxAttempts of 10", async () => {
    // Occupy 10 ports to trigger error with default maxAttempts
    for (let i = 0; i < 10; i++) {
      const server = net.createServer();
      servers.push(server);
      await new Promise<void>((resolve) => {
        server.listen(19950 + i, () => resolve());
      });
    }

    await expect(findAvailablePort(19950)).rejects.toThrow("Ports 19950-19959 are all in use");
  });
});
