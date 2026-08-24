import { randomUUID } from "node:crypto";
import { Mutex } from "async-mutex";
import {
  CommandIdSchema,
  FolderIdSchema,
  IsoDateTimeSchema,
  RecordingIdSchema,
  RequestIdSchema,
  RuntimeIdSchema,
  type ScenarioId,
  ScenarioIdSchema,
  TransferIdSchema,
} from "../../../shared/contracts-v2/primitives.js";
import type {
  ClockPort,
  IdGeneratorPort,
  LoggerPort,
  OperationContext,
  StoreLeasePort,
  StructuredLogFields,
  WriteCoordinatorPort,
} from "../application/ports.js";
import { OperationAbortedError } from "../domain/errors.js";

function randomMaterial(): string {
  return randomUUID().replaceAll("-", "");
}

export class SystemClock implements ClockPort {
  now() {
    return IsoDateTimeSchema.parse(new Date().toISOString());
  }
}

export class RandomIdGenerator implements IdGeneratorPort {
  nextFolderId() {
    return FolderIdSchema.parse(`fld_${randomMaterial()}`);
  }

  nextScenarioId() {
    return ScenarioIdSchema.parse(`scn_${randomMaterial()}`);
  }

  nextRecordingId() {
    return RecordingIdSchema.parse(`rec_${randomMaterial()}`);
  }

  nextRuntimeId() {
    return RuntimeIdSchema.parse(`run_${randomMaterial()}`);
  }

  nextCommandId() {
    return CommandIdSchema.parse(`cmd_${randomMaterial()}`);
  }

  nextRequestId() {
    return RequestIdSchema.parse(`req_${randomMaterial()}`);
  }

  nextTransferId() {
    return TransferIdSchema.parse(`xfer_${randomMaterial()}`);
  }
}

function assertNotAborted(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new OperationAbortedError(undefined, context.signal.reason);
}

/** Process-local ordering plus one cross-process lease per catalog transaction. */
export class ProcessWriteCoordinator implements WriteCoordinatorPort {
  readonly #catalog = new Mutex();
  readonly #scenarios = new Map<ScenarioId, Mutex>();

  constructor(private readonly lease?: StoreLeasePort) {}

  async withCatalogWrite<Result>(operation: () => Promise<Result>, context?: OperationContext): Promise<Result> {
    assertNotAborted(context);
    return this.#catalog.runExclusive(async () => {
      assertNotAborted(context);
      const lease = await this.lease?.acquire(context);
      let result: Result | undefined;
      let operationError: unknown;
      let operationFailed = false;
      try {
        result = await (lease && this.lease?.runWithHandle ? this.lease.runWithHandle(lease, operation) : operation());
      } catch (error) {
        operationFailed = true;
        operationError = error;
      }
      let releaseError: unknown;
      let releaseFailed = false;
      try {
        await lease?.release();
      } catch (error) {
        releaseFailed = true;
        releaseError = error;
      }
      if (operationFailed) {
        throw operationError;
      }
      if (releaseFailed) throw releaseError;
      return result as Result;
    });
  }

  async withScenarioWrite<Result>(
    scenarioId: ScenarioId,
    operation: () => Promise<Result>,
    context?: OperationContext,
  ): Promise<Result> {
    assertNotAborted(context);
    let mutex = this.#scenarios.get(scenarioId);
    if (!mutex) {
      mutex = new Mutex();
      this.#scenarios.set(scenarioId, mutex);
    }
    return mutex.runExclusive(async () => {
      assertNotAborted(context);
      return operation();
    });
  }
}

export interface ConsoleLoggerOptions {
  verbose?: boolean;
  write?: (line: string) => void;
}

const SENSITIVE_FIELD = /authorization|cookie|password|secret|token|api[-_]?key/iu;

function safeFields(fields: StructuredLogFields | undefined): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (SENSITIVE_FIELD.test(key)) return [key, "[redacted]"];
      if (value instanceof Error) return [key, { name: value.name, message: value.message }];
      return [key, value];
    }),
  );
}

export class ConsoleLogger implements LoggerPort {
  readonly #verbose: boolean;
  readonly #write: (line: string) => void;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.#verbose = options.verbose ?? false;
    this.#write = options.write ?? console.log;
  }

  debug(message: string, fields?: StructuredLogFields): void {
    if (this.#verbose) this.#log("DEBUG", message, fields);
  }

  info(message: string, fields?: StructuredLogFields): void {
    this.#log("INFO", message, fields);
  }

  warn(message: string, fields?: StructuredLogFields): void {
    this.#log("WARN", message, fields);
  }

  error(message: string, fields?: StructuredLogFields): void {
    this.#log("ERROR", message, fields);
  }

  #log(level: string, message: string, fields?: StructuredLogFields): void {
    const metadata = safeFields(fields);
    this.#write(`${level} ${message}${metadata ? ` ${JSON.stringify(metadata)}` : ""}`);
  }
}
