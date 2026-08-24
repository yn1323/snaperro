import type { CommandOf, CommandResult } from "../../../shared/contracts-v2/commands.js";
import type { RecordingDraft } from "../../../shared/contracts-v2/entities.js";
import type { CommandId, TransferId } from "../../../shared/contracts-v2/primitives.js";
import { isDomainError } from "../domain/errors.js";
import type { RecordingCommandHandlersPort } from "./bus.js";
import type { GarbageCollectionPort, LoggerPort, OperationContext } from "./ports.js";
import { runBestEffortPostCommit } from "./service-support.js";

export interface ImportedRecordingArchive {
  filename: string;
  recording: RecordingDraft;
}

export interface RecordingImportSourcePort {
  claimRecording(
    transferId: TransferId,
    claimId: CommandId,
    context?: OperationContext,
  ): Promise<ImportedRecordingArchive>;
  materializeRecordingBlobs(transferId: TransferId, claimId: CommandId, context?: OperationContext): Promise<void>;
  completeRecording(transferId: TransferId, claimId: CommandId): Promise<void>;
  releaseRecording(transferId: TransferId, claimId: CommandId): Promise<void>;
}

export interface RecordingImportServiceDependencies {
  recordings: Pick<RecordingCommandHandlersPort, "create">;
  imports: RecordingImportSourcePort;
  garbageCollection: GarbageCollectionPort;
  logger: LoggerPort;
}

export class RecordingImportService {
  constructor(private readonly dependencies: RecordingImportServiceDependencies) {}

  async execute(
    command: CommandOf<"recording.import">,
    context: OperationContext = {},
  ): Promise<CommandResult<"recording.import">> {
    const archive = await this.dependencies.imports.claimRecording(command.transferId, command.commandId, context);
    try {
      // Promotion happens before RecordingService acquires its catalog lease.
      // RecordingService then validates every BodyRef and derives the request
      // fingerprint from the materialized bytes inside the commit boundary.
      await this.dependencies.imports.materializeRecordingBlobs(command.transferId, command.commandId, context);
      const result = await this.dependencies.recordings.create(
        {
          protocolVersion: command.protocolVersion,
          commandId: command.commandId,
          type: "recording.create",
          scenarioId: command.scenarioId,
          expectedScenarioRevision: command.expectedScenarioRevision,
          filename: archive.filename,
          recording: archive.recording,
        },
        context,
      );
      await runBestEffortPostCommit(
        () => this.dependencies.imports.completeRecording(command.transferId, command.commandId),
        this.dependencies.logger,
        "Committed recording import could not remove its staged transfer",
        { transferId: command.transferId },
      );
      return result;
    } catch (error) {
      await runBestEffortPostCommit(
        () =>
          isDomainError(error) && error.retryable
            ? this.dependencies.imports.releaseRecording(command.transferId, command.commandId)
            : this.dependencies.imports.completeRecording(command.transferId, command.commandId),
        this.dependencies.logger,
        "Failed to finalize an unsuccessful recording import claim",
        { transferId: command.transferId },
      );
      await runBestEffortPostCommit(
        () => this.dependencies.garbageCollection.schedule(),
        this.dependencies.logger,
        "Failed to schedule garbage collection after an aborted recording import",
        { transferId: command.transferId },
      );
      throw error;
    }
  }
}
