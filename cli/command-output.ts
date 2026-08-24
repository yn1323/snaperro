export interface CommandOutput {
  stdout(message: string): void;
  stderr(message: string): void;
}

export const processCommandOutput: CommandOutput = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

/** Escape control characters before putting filesystem-derived text on a terminal. */
export function printable(value: string): string {
  return JSON.stringify(value)
    .slice(1, -1)
    .replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === undefined ? "" : `\\u{${codePoint.toString(16).padStart(4, "0")}}`;
    });
}

export function errorSummary(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

export function writeJson(output: CommandOutput, value: unknown): void {
  output.stdout(`${JSON.stringify(value, null, 2)}\n`);
}
