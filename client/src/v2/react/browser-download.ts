import { type DownloadTicket, DownloadTicketSchema } from "../contracts";
import { ApiError } from "../infrastructure/api-error";

export interface BrowserDownloadPort {
  ticket(input: unknown): void;
}

export interface BrowserDownloadPlatform {
  clickDownload(downloadPath: string, filename: string): void;
}

export interface BrowserDownloadOptions {
  platform?: BrowserDownloadPlatform;
}

function browserPlatform(): BrowserDownloadPlatform {
  return {
    clickDownload(downloadPath, filename) {
      const anchor = document.createElement("a");
      anchor.href = downloadPath;
      anchor.download = filename;
      anchor.rel = "noopener noreferrer";
      anchor.referrerPolicy = "no-referrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
  };
}

function validateTicket(input: unknown): DownloadTicket {
  const parsed = DownloadTicketSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("Download ticket did not match the v2 contract", {
      code: "INVALID_RESPONSE",
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * Starts a same-origin native download from a short-lived capability URL.
 * The browser owns the response stream, so large files never enter JS memory.
 */
export function createBrowserDownloadPort(options: BrowserDownloadOptions = {}): BrowserDownloadPort {
  const platform = options.platform ?? browserPlatform();
  return {
    ticket(input) {
      const download = validateTicket(input);
      platform.clickDownload(download.downloadPath, download.filename);
    },
  };
}
