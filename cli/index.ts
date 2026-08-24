import { createProgram } from "./program.js";

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : "snaperro command failed");
  process.exitCode = 1;
}
