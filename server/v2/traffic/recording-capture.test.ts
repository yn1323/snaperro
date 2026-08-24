import { describe, expect, it, vi } from "vitest";
import { RecordingDraftSchema } from "../../../shared/contracts-v2/entities.js";
import { ScenarioIdSchema } from "../../../shared/contracts-v2/primitives.js";
import type { RecordingService } from "../application/recording-service.js";
import { ApplicationRecordingCapture } from "./recording-capture.js";

describe("ApplicationRecordingCapture", () => {
  it("delegates capture to the atomic application service", async () => {
    const input = {
      scenarioId: ScenarioIdSchema.parse("scn_0123456789abcdef"),
      recording: RecordingDraftSchema.parse({
        route: "/users/:id",
        method: "GET",
        request: { pathParams: { id: "1" }, query: [], headers: [], body: null },
        response: { status: 200, statusText: "OK", headers: [], body: null },
      }),
    };
    const expected = { id: "rec_0123456789abcdef" } as never;
    const capture = vi.fn(async () => expected);
    const subject = new ApplicationRecordingCapture({
      recordings: { capture } as unknown as Pick<RecordingService, "capture">,
    });

    await expect(subject.upsert(input)).resolves.toBe(expected);
    expect(capture).toHaveBeenCalledWith(input, {});
  });
});
