import { Command } from "commander";
import { demoCommand } from "./commands/demo.js";
import { initCommand } from "./commands/init.js";
import { postmanCommand } from "./commands/postman.js";
import { startCommand } from "./commands/start.js";

const program = new Command();

program.name("snaperro").description("Mock proxy server 🐕").version("1.0.0");

program.command("init").description("Initialize project").action(initCommand);

program
  .command("start")
  .description("Start server")
  .option("-p, --port <port>", "Port number", "3333")
  .option("-v, --verbose", "Show verbose logs")
  .option("-c, --config <path>", "Config file path", "snaperro.config.ts")
  .option("-e, --env <path>", "Env file path")
  .action(startCommand);

program.command("postman").description("Output Postman collection").action(postmanCommand);

program
  .command("demo")
  .description("Open demo page in browser")
  .option("-p, --port <port>", "Port number", "3333")
  .action(demoCommand);

program.parse();
