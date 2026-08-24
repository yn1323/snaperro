import { describe, expect, it, vi } from "vitest";
import { RecordingDraftSchema } from "../../../shared/contracts-v2/entities.js";
import { RevisionSchema, TransferIdSchema } from "../../../shared/contracts-v2/primitives.js";
import { InvalidArgumentError, RevisionConflictError } from "../domain/errors.js";
import { RecordingImportService } from "./recording-import-service.js";
import { applicationTestIds, CapturingLogger, recordingFixture } from "./test-doubles.js";

const transferId = TransferIdSchema.parse("xfer_0123456789abcdef");
const recording = recordingFixture();
const draft = RecordingDraftSchema.parse({
  route: recording.route,
  method: recording.method,
  request: recording.request,
  response: recording.response,
});

function command() {
  return {
    protocolVersion: 2 as const,
    commandId: applicationTestIds.command,
    type: "recording.import" as const,
    scenarioId: applicationTestIds.scenario,
    expectedScenarioRevision: RevisionSchema.parse(3),
    transferId,
  };
}

describe("RecordingImportService", () => {
  it("materializes archive blobs before delegating to the canonical create path", async () => {
    const order: string[] = [];
    const create = vi.fn(async () => {
      order.push("create");
      return { revision: RevisionSchema.parse(5), scenarioRevision: RevisionSchema.parse(4), recording };
    });
    const completeRecording = vi.fn(async () => undefined);
    const subject = new RecordingImportService({
      recordings: { create },
      imports: {
        claimRecording: vi.fn(async () => ({ filename: "portable.json", recording: draft })),
        materializeRecordingBlobs: vi.fn(async () => {
          order.push("materialize");
        }),
        completeRecording,
        releaseRecording: vi.fn(),
      },
      garbageCollection: { schedule: vi.fn(async () => undefined) },
      logger: new CapturingLogger(),
    });

    await expect(subject.execute(command())).resolves.toMatchObject({ scenarioRevision: 4, recording });
    expect(order).toEqual(["materialize", "create"]);
    expect(create).toHaveBeenCalledWith(
      {
        protocolVersion: 2,
        commandId: applicationTestIds.command,
        type: "recording.create",
        scenarioId: applicationTestIds.scenario,
        expectedScenarioRevision: RevisionSchema.parse(3),
        filename: "portable.json",
        recording: draft,
      },
      {},
    );
    expect(completeRecording).toHaveBeenCalledWith(transferId, applicationTestIds.command);
  });

  it("keeps a failed staged import retryable and schedules orphan cleanup", async () => {
    const failure = new RevisionConflictError(RevisionSchema.parse(3), RevisionSchema.parse(4));
    const completeRecording = vi.fn(async () => undefined);
    const releaseRecording = vi.fn(async () => undefined);
    const schedule = vi.fn(async () => undefined);
    const subject = new RecordingImportService({
      recordings: { create: vi.fn(async () => Promise.reject(failure)) },
      imports: {
        claimRecording: vi.fn(async () => ({ filename: "portable.json", recording: draft })),
        materializeRecordingBlobs: vi.fn(async () => undefined),
        completeRecording,
        releaseRecording,
      },
      garbageCollection: { schedule },
      logger: new CapturingLogger(),
    });

    await expect(subject.execute(command())).rejects.toBe(failure);
    expect(completeRecording).not.toHaveBeenCalled();
    expect(releaseRecording).toHaveBeenCalledWith(transferId, applicationTestIds.command);
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith();
  });

  it("burns a staged import after a non-retryable failure", async () => {
    const failure = new InvalidArgumentError("invalid archive body");
    const completeRecording = vi.fn(async () => undefined);
    const releaseRecording = vi.fn(async () => undefined);
    const subject = new RecordingImportService({
      recordings: { create: vi.fn(async () => Promise.reject(failure)) },
      imports: {
        claimRecording: vi.fn(async () => ({ filename: "portable.json", recording: draft })),
        materializeRecordingBlobs: vi.fn(async () => undefined),
        completeRecording,
        releaseRecording,
      },
      garbageCollection: { schedule: vi.fn(async () => undefined) },
      logger: new CapturingLogger(),
    });

    await expect(subject.execute(command())).rejects.toBe(failure);
    expect(completeRecording).toHaveBeenCalledWith(transferId, applicationTestIds.command);
    expect(releaseRecording).not.toHaveBeenCalled();
  });
});
