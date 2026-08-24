import { Hono } from "hono";
import type { HeaderFields } from "../../../shared/contracts-v2/primitives.js";
import { normalizeTrafficResponseHeaders, responseAllowsBody } from "../domain/http-representation.js";
import type { IncomingTrafficRequest, TrafficResponse } from "../traffic/proxy-service.js";
import type { TrafficService } from "../traffic/traffic-service.js";
import { domainErrorResponse } from "./domain-error-response.js";

export interface TrafficHandlerPort {
  execute(request: IncomingTrafficRequest): Promise<TrafficResponse>;
}

function responseHeaders(fields: HeaderFields): Headers {
  const headers = new Headers();
  for (const [name, value] of fields) headers.append(name, value);
  return headers;
}

export function createTrafficApi(traffic: TrafficHandlerPort | TrafficService): Hono {
  const app = new Hono();
  app.onError(domainErrorResponse);
  app.all("*", async (context) => {
    const response = await traffic.execute({
      method: context.req.method,
      url: context.req.url,
      headers: context.req.raw.headers,
      body: context.req.raw.body,
      signal: context.req.raw.signal,
    });
    const bodyAllowed = responseAllowsBody(context.req.method, response.status);
    if (!bodyAllowed && response.body) void response.body.cancel().catch(() => undefined);
    return new Response(bodyAllowed ? response.body : null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(normalizeTrafficResponseHeaders(context.req.method, response.status, response.headers)),
    });
  });
  return app;
}
