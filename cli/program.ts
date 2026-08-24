import { Command } from "commander";
import { VERSION } from "../server/version.js";
import { demoCommand } from "./commands/demo.js";
import { type DoctorCommandOptions, doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { type MigrateCommandOptions, migrateCommand } from "./commands/migrate.js";
import { postmanCommand } from "./commands/postman.js";
import { type StartOptions, startCommand } from "./commands/start.js";

export interface CreateProgramOptions {
  version?: string;
  migrateAction?: (options: MigrateCommandOptions) => Promise<number>;
  doctorAction?: (options: DoctorCommandOptions) => Promise<number>;
  setExitCode?: (code: number) => void;
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();

  program
    .name("snaperro")
    .description("Mock proxy server 🐕")
    .version(options.version ?? VERSION);

  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });

  program
    .command("init")
    .description("Initialize project")
    .action(() => initCommand());

  program
    .command("start")
    .description("Start server")
    .option("-p, --port <port>", "Override the configured port")
    .option("-v, --verbose", "Show verbose logs")
    .option("-c, --config <path>", "Config file path", "snaperro.config.ts")
    .option("-e, --env <path>", "Env file path")
    .option("--no-watch", "Disable config file watching")
    .option("--skip-browser", "Do not open the GUI in a browser")
    .action(async (commandOptions: StartOptions) => {
      await startCommand(commandOptions);
    });

  program
    .command("postman")
    .description("Output Postman collection")
    .action(() => postmanCommand());

  program
    .command("demo")
    .description("Open demo page in browser")
    .option("-p, --port <port>", "Override the configured port")
    .option("-c, --config <path>", "v2 config file")
    .action((commandOptions: { port?: string; config?: string }) => demoCommand(commandOptions));

  program
    .command("migrate")
    .description("Copy v1 data into the v2 store")
    .option("-s, --source <path>", "v1 files directory", ".snaperro/files")
    .option("-d, --destination <path>", "v2 store directory", ".snaperro/v2")
    .option("--state <path>", "v1 state file", ".snaperro/state.json")
    .option("--dry-run", "Validate and report without writing")
    .option("--json", "Emit machine-readable JSON")
    .action(async (commandOptions: MigrateCommandOptions) => {
      setExitCode(await (options.migrateAction ?? migrateCommand)(commandOptions));
    });

  program
    .command("doctor")
    .description("Validate the v2 config and store without modifying them")
    .option("-c, --config <path>", "v2 config file", "snaperro.config.ts")
    .option("-e, --env <path>", "Env file path")
    .option("--json", "Emit machine-readable JSON")
    .action(async (commandOptions: DoctorCommandOptions) => {
      setExitCode(await (options.doctorAction ?? doctorCommand)(commandOptions));
    });

  return program;
}
