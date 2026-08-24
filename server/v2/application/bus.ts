import {
  type CommandOf,
  type CommandResult,
  CommandSchema,
  type CommandType,
} from "../../../shared/contracts-v2/commands.js";
import { type QueryOf, type QueryResult, QuerySchema, type QueryType } from "../../../shared/contracts-v2/queries.js";
import { InvalidArgumentError } from "../domain/errors.js";
import type { CommandBusPort, OperationContext, QueryBusPort } from "./ports.js";

function assertNever(value: never): never {
  throw new Error(`Unhandled application message: ${JSON.stringify(value)}`);
}

type CommandHandler<Type extends CommandType> = (
  command: CommandOf<Type>,
  context?: OperationContext,
) => Promise<CommandResult<Type>>;

export interface CatalogCommandHandlersPort {
  setMode: CommandHandler<"mode.set">;
  selectScenario: CommandHandler<"scenario.select">;
  createFolder: CommandHandler<"folder.create">;
  renameFolder: CommandHandler<"folder.rename">;
  deleteFolder: CommandHandler<"folder.delete">;
}

export interface ScenarioCommandHandlersPort {
  create: CommandHandler<"scenario.create">;
  rename: CommandHandler<"scenario.rename">;
  duplicate: CommandHandler<"scenario.duplicate">;
  delete: CommandHandler<"scenario.delete">;
}

export interface RecordingCommandHandlersPort {
  create: CommandHandler<"recording.create">;
  update: CommandHandler<"recording.update">;
  delete: CommandHandler<"recording.delete">;
}

export interface RecordingImportCommandHandlerPort {
  execute(
    command: CommandOf<"recording.import">,
    context?: OperationContext,
  ): Promise<CommandResult<"recording.import">>;
}

export interface FolderImportCommandHandlerPort {
  execute(command: CommandOf<"folder.import">, context?: OperationContext): Promise<CommandResult<"folder.import">>;
}

export interface ApplicationCommandBusDependencies {
  catalog: CatalogCommandHandlersPort;
  scenarios: ScenarioCommandHandlersPort;
  recordings: RecordingCommandHandlersPort;
  recordingImport: RecordingImportCommandHandlerPort;
  folderImport: FolderImportCommandHandlerPort;
}

export class ApplicationCommandBus implements CommandBusPort {
  constructor(private readonly handlers: ApplicationCommandBusDependencies) {}

  async execute<Type extends CommandType>(
    input: CommandOf<Type>,
    context: OperationContext = {},
  ): Promise<CommandResult<Type>> {
    const parsed = CommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidArgumentError("Invalid command", { issues: parsed.error.issues });
    }

    const command = parsed.data;
    let result: unknown;
    switch (command.type) {
      case "mode.set":
        result = await this.handlers.catalog.setMode(command, context);
        break;
      case "scenario.select":
        result = await this.handlers.catalog.selectScenario(command, context);
        break;
      case "folder.create":
        result = await this.handlers.catalog.createFolder(command, context);
        break;
      case "folder.rename":
        result = await this.handlers.catalog.renameFolder(command, context);
        break;
      case "folder.delete":
        result = await this.handlers.catalog.deleteFolder(command, context);
        break;
      case "folder.import":
        result = await this.handlers.folderImport.execute(command, context);
        break;
      case "scenario.create":
        result = await this.handlers.scenarios.create(command, context);
        break;
      case "scenario.rename":
        result = await this.handlers.scenarios.rename(command, context);
        break;
      case "scenario.duplicate":
        result = await this.handlers.scenarios.duplicate(command, context);
        break;
      case "scenario.delete":
        result = await this.handlers.scenarios.delete(command, context);
        break;
      case "recording.create":
        result = await this.handlers.recordings.create(command, context);
        break;
      case "recording.import":
        result = await this.handlers.recordingImport.execute(command, context);
        break;
      case "recording.update":
        result = await this.handlers.recordings.update(command, context);
        break;
      case "recording.delete":
        result = await this.handlers.recordings.delete(command, context);
        break;
      default:
        return assertNever(command);
    }
    return result as CommandResult<Type>;
  }
}

export type QueryHandler<Type extends QueryType> = (
  query: QueryOf<Type>,
  context?: OperationContext,
) => Promise<QueryResult<Type>>;

export type QueryHandlerMap = {
  [Type in QueryType]: QueryHandler<Type>;
};

/** Runtime-validating dispatch boundary; query implementations remain independently replaceable. */
export class ApplicationQueryBus implements QueryBusPort {
  constructor(private readonly handlers: QueryHandlerMap) {}

  async execute<Type extends QueryType>(
    input: QueryOf<Type>,
    context: OperationContext = {},
  ): Promise<QueryResult<Type>> {
    const parsed = QuerySchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidArgumentError("Invalid query", { issues: parsed.error.issues });
    }

    const query = parsed.data;
    let result: unknown;
    switch (query.type) {
      case "runtime.snapshot":
        result = await this.handlers["runtime.snapshot"](query, context);
        break;
      case "folder.list":
        result = await this.handlers["folder.list"](query, context);
        break;
      case "folder.export":
        result = await this.handlers["folder.export"](query, context);
        break;
      case "scenario.list":
        result = await this.handlers["scenario.list"](query, context);
        break;
      case "scenario.get":
        result = await this.handlers["scenario.get"](query, context);
        break;
      case "recording.list":
        result = await this.handlers["recording.list"](query, context);
        break;
      case "recording.search":
        result = await this.handlers["recording.search"](query, context);
        break;
      case "recording.get":
        result = await this.handlers["recording.get"](query, context);
        break;
      case "recording.body":
        result = await this.handlers["recording.body"](query, context);
        break;
      case "recording.export":
        result = await this.handlers["recording.export"](query, context);
        break;
      case "body.download":
        result = await this.handlers["body.download"](query, context);
        break;
      default:
        return assertNever(query);
    }
    return result as QueryResult<Type>;
  }
}
