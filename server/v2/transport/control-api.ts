import { Hono } from "hono";
import {
  type Command,
  CommandResultSchemas,
  CommandSchema,
  type CommandType,
} from "../../../shared/contracts-v2/commands.js";
import { type Query, QueryResultSchemas, QuerySchema, type QueryType } from "../../../shared/contracts-v2/queries.js";
import { MAX_CONTROL_JSON_BYTES, V2_RELATIVE_PATHS } from "../../../shared/contracts-v2/transport.js";
import type { CommandBusPort, QueryBusPort } from "../application/ports.js";
import { InvalidArgumentError } from "../domain/errors.js";
import { domainErrorResponse } from "./domain-error-response.js";
import { readLimitedJson } from "./request-body.js";

export interface ControlApiDependencies {
  commands: CommandBusPort;
  queries: QueryBusPort;
  maxJsonBodyBytes?: number;
}

async function executeCommand(commands: CommandBusPort, command: Command) {
  const result = await commands.execute<CommandType>(command);
  return CommandResultSchemas[command.type].parse(result);
}

async function executeQuery(queries: QueryBusPort, query: Query) {
  const result = await queries.execute<QueryType>(query);
  return QueryResultSchemas[query.type].parse(result);
}

export function createControlApi(dependencies: ControlApiDependencies): Hono {
  const app = new Hono();
  const maxJsonBodyBytes = dependencies.maxJsonBodyBytes ?? MAX_CONTROL_JSON_BYTES;
  if (!Number.isSafeInteger(maxJsonBodyBytes) || maxJsonBodyBytes < 1) {
    throw new Error("maxJsonBodyBytes must be a positive safe integer");
  }

  app.onError(domainErrorResponse);

  app.get("/snapshot", async (context) => {
    const result = await executeQuery(dependencies.queries, { protocolVersion: 2, type: "runtime.snapshot" });
    return context.json(result);
  });

  app.post(V2_RELATIVE_PATHS.commands, async (context) => {
    const decoded = CommandSchema.safeParse(await readLimitedJson(context, maxJsonBodyBytes));
    if (!decoded.success) {
      throw new InvalidArgumentError("Command contract validation failed", { issues: decoded.error.issues });
    }
    return context.json(await executeCommand(dependencies.commands, decoded.data));
  });

  app.post(V2_RELATIVE_PATHS.queries, async (context) => {
    const decoded = QuerySchema.safeParse(await readLimitedJson(context, maxJsonBodyBytes));
    if (!decoded.success) {
      throw new InvalidArgumentError("Query contract validation failed", { issues: decoded.error.issues });
    }
    return context.json(await executeQuery(dependencies.queries, decoded.data));
  });

  return app;
}
