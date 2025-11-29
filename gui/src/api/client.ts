const API_BASE = "/__snaperro__";

export type Mode = "proxy" | "record" | "mock";

export interface Status {
  mode: Mode;
  pattern: string;
}

export interface FileInfo {
  path: string;
  method: string;
  status: number;
  size: number;
}

export const api = {
  async getStatus(): Promise<Status> {
    const res = await fetch(`${API_BASE}/status`);
    return res.json();
  },

  async setMode(mode: Mode): Promise<{ mode: Mode }> {
    const res = await fetch(`${API_BASE}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    return res.json();
  },

  async setPattern(pattern: string): Promise<{ pattern: string }> {
    const res = await fetch(`${API_BASE}/pattern`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern }),
    });
    return res.json();
  },

  async resetCounter(): Promise<void> {
    await fetch(`${API_BASE}/reset`, { method: "POST" });
  },

  async getPatterns(): Promise<{ patterns: string[] }> {
    const res = await fetch(`${API_BASE}/patterns`);
    return res.json();
  },

  async createPattern(name: string): Promise<void> {
    await fetch(`${API_BASE}/patterns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },

  async getPatternFiles(pattern: string): Promise<{ files: FileInfo[] }> {
    const res = await fetch(`${API_BASE}/patterns/${encodeURIComponent(pattern)}/files`);
    return res.json();
  },

  async getFile(filePath: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}/files/${filePath}`);
    return res.json();
  },

  async deleteFile(filePath: string): Promise<void> {
    await fetch(`${API_BASE}/files/${filePath}`, { method: "DELETE" });
  },
};
