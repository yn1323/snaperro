import type { Recording, RecordingDraft } from "../../../shared/contracts-v2/entities.js";
import type { ScenarioId } from "../../../shared/contracts-v2/primitives.js";
import type { OperationContext } from "../application/ports.js";
import type { CaptureRecordingInput, RecordingService } from "../application/recording-service.js";

export interface RecordingCapturePort {
  upsert(input: CaptureRecordingInput, context?: OperationContext): Promise<Recording>;
}

export interface ApplicationRecordingCaptureDependencies {
  recordings: Pick<RecordingService, "capture">;
}

/** Delegates traffic capture to the application's atomic scenario transaction. */
export class ApplicationRecordingCapture implements RecordingCapturePort {
  constructor(private readonly dependencies: ApplicationRecordingCaptureDependencies) {}

  upsert(
    input: { scenarioId: ScenarioId; recording: RecordingDraft },
    context: OperationContext = {},
  ): Promise<Recording> {
    return this.dependencies.recordings.capture(input, context);
  }
}
