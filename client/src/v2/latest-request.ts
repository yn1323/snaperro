export interface LatestRequestToken {
  readonly id: number;
  readonly signal: AbortSignal;
  isLatest: () => boolean;
}

export type LatestRequestResult<T> = { kind: "applied"; value: T } | { kind: "stale" } | { kind: "aborted" };

interface ActiveRequest {
  id: number;
  controller: AbortController;
  superseded: boolean;
}

export class LatestRequestRunner {
  private sequence = 0;
  private active: ActiveRequest | null = null;

  start(): LatestRequestToken {
    if (this.active) {
      this.active.superseded = true;
      this.active.controller.abort();
    }

    const request: ActiveRequest = {
      id: ++this.sequence,
      controller: new AbortController(),
      superseded: false,
    };
    this.active = request;

    return {
      id: request.id,
      signal: request.controller.signal,
      isLatest: () => this.active === request && !request.controller.signal.aborted,
    };
  }

  cancel(): void {
    if (!this.active) return;
    this.active.controller.abort();
    this.active = null;
  }

  async run<T>(operation: (token: LatestRequestToken) => Promise<T>): Promise<LatestRequestResult<T>> {
    const token = this.start();
    const request = this.active;
    if (!request) return { kind: "aborted" };

    try {
      const value = await operation(token);
      if (request.superseded) return { kind: "stale" };
      if (request.controller.signal.aborted) return { kind: "aborted" };
      if (this.active !== request) return { kind: "stale" };
      this.active = null;
      return { kind: "applied", value };
    } catch (error) {
      if (request.superseded) return { kind: "stale" };
      if (request.controller.signal.aborted) {
        if (this.active === request) this.active = null;
        return { kind: "aborted" };
      }
      if (this.active !== request) return { kind: "stale" };
      this.active = null;
      throw error;
    }
  }
}
