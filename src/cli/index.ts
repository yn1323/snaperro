#!/usr/bin/env node
import { Command } from "commander";
import { demoCommand } from "./commands/demo.js";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";

const program = new Command();

program.name("snaperro").description("GUI付きモックプロキシサーバー 🐕").version("1.0.0");

program.command("init").description("プロジェクトを初期化").action(initCommand);

program
  .command("start")
  .description("サーバーを起動")
  .option("-p, --port <port>", "ポート番号", "3333")
  .option("-v, --verbose", "詳細ログを表示")
  .option("-c, --config <path>", "設定ファイルのパス", "snaperro.config.ts")
  .action(startCommand);

program
  .command("demo")
  .description("デモページを起動してsnaperroの動作を確認")
  .option("-p, --port <port>", "デモページのポート番号", "5173")
  .action(demoCommand);

program.parse();
