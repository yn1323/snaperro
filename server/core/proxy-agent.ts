import { ProxyAgent } from "undici";
import type { SnaperroConfig } from "../types/config.js";
import { logger } from "./logger.js";

let proxyAgent: ProxyAgent | undefined;

/**
 * Initialize proxy agent from config or environment variables
 * Config takes priority over environment variables
 */
export function initializeProxyAgent(config: SnaperroConfig): void {
  // Priority 1: Config file
  let proxyUrl = config.upstreamProxy?.url;

  // Priority 2: Environment variables (HTTPS_PROXY > HTTP_PROXY, case insensitive)
  if (!proxyUrl) {
    proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  }

  if (proxyUrl) {
    proxyAgent = new ProxyAgent(proxyUrl);
    const maskedUrl = maskProxyUrl(proxyUrl);
    logger.info(`Upstream proxy configured: ${maskedUrl}`);
  }
}

/**
 * Get the configured proxy agent (or undefined if not configured)
 */
export function getProxyAgent(): ProxyAgent | undefined {
  return proxyAgent;
}

/**
 * Mask credentials in proxy URL for safe logging
 */
function maskProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "***" : "";
      parsed.password = parsed.password ? "***" : "";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
