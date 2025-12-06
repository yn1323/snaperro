import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get package version from package.json
 */
function getPackageVersion(): string {
  try {
    // Try multiple possible locations for package.json
    const possiblePaths = [
      path.join(__dirname, "..", "..", "package.json"), // From dist/server/core/
      path.join(__dirname, "..", "..", "..", "package.json"), // Alternative
    ];

    for (const pkgPath of possiblePaths) {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        return pkg.version || "unknown";
      }
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export const VERSION = getPackageVersion();
