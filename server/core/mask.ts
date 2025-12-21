/**
 * Mask a sensitive value by showing first 4 characters + asterisks
 *
 * @param value The value to mask
 * @returns Masked value (e.g., "Bear**********")
 */
export function maskValue(value: string): string {
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }
  const visible = value.slice(0, 4);
  const asteriskCount = Math.min(value.length - 4, 10);
  return `${visible}${"*".repeat(asteriskCount)}`;
}

/**
 * Mask specified headers in a headers object
 *
 * @param headers Original headers object
 * @param headerNamesToMask Array of header names to mask (case-insensitive)
 * @returns New headers object with specified headers masked
 */
export function maskHeaders(
  headers: Record<string, string>,
  headerNamesToMask: string[] | undefined,
): Record<string, string> {
  if (!headerNamesToMask || headerNamesToMask.length === 0) {
    return headers;
  }

  const maskSet = new Set(headerNamesToMask.map((h) => h.toLowerCase()));

  const maskedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (maskSet.has(key.toLowerCase())) {
      maskedHeaders[key] = maskValue(value);
    } else {
      maskedHeaders[key] = value;
    }
  }

  return maskedHeaders;
}

/**
 * Merge root-level and API-level mask header arrays
 *
 * @param rootMask Root-level maskRequestHeaders
 * @param apiMask API-level maskRequestHeaders
 * @returns Merged array (deduplicated, case-insensitive) or undefined if both are empty
 */
export function getMergedMaskHeaders(
  rootMask: string[] | undefined,
  apiMask: string[] | undefined,
): string[] | undefined {
  if (!rootMask && !apiMask) return undefined;
  if (!rootMask) return apiMask;
  if (!apiMask) return rootMask;
  const set = new Set([...rootMask.map((h) => h.toLowerCase()), ...apiMask.map((h) => h.toLowerCase())]);
  return Array.from(set);
}
