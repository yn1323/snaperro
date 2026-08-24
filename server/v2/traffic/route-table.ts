const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export interface RouteApiConfig {
  target: string;
  routes: readonly string[];
}

export interface RouteMatch<Api extends RouteApiConfig> {
  apiKey: string;
  api: Api;
  method: string | null;
  route: string;
  pathParams: Record<string, string>;
}

interface CompiledRoute<Api extends RouteApiConfig> {
  apiKey: string;
  api: Api;
  method: string | null;
  route: string;
  parameterNames: string[];
  regex: RegExp;
  segments: readonly string[];
  staticSegments: number;
  declarationOrder: number;
}

export class InvalidRouteError extends Error {
  constructor(
    readonly route: string,
    message: string,
  ) {
    super(`Invalid route "${route}": ${message}`);
    this.name = "InvalidRouteError";
  }
}

export class AmbiguousRouteError extends Error {
  constructor(
    readonly first: string,
    readonly second: string,
  ) {
    super(`Routes "${first}" and "${second}" match the same requests`);
    this.name = "AmbiguousRouteError";
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compileRoute<Api extends RouteApiConfig>(
  apiKey: string,
  api: Api,
  source: string,
  declarationOrder: number,
): CompiledRoute<Api> {
  const route = source.trim();
  const methodMatch = route.match(/^([A-Za-z]+)\s+(.+)$/u);
  let method: string | null = null;
  let routePath = route;

  if (methodMatch) {
    method = methodMatch[1].toUpperCase();
    routePath = methodMatch[2].trim();
    if (!HTTP_METHODS.has(method)) throw new InvalidRouteError(source, `unsupported HTTP method ${method}`);
  }
  if (!routePath.startsWith("/")) throw new InvalidRouteError(source, "path must start with /");
  if (routePath.includes("?") || routePath.includes("#")) {
    throw new InvalidRouteError(source, "query strings and fragments are not allowed");
  }
  if (routePath.length > 1 && routePath.endsWith("/")) {
    throw new InvalidRouteError(source, "trailing slashes are not canonical");
  }

  const parameterNames: string[] = [];
  const signatureSegments: string[] = [];
  const regexSegments: string[] = [];
  let staticSegments = 0;
  for (const segment of routePath.split("/")) {
    if (segment.startsWith(":")) {
      const name = segment.slice(1);
      if (!PARAMETER_NAME.test(name)) throw new InvalidRouteError(source, `invalid parameter name ${name}`);
      if (parameterNames.includes(name)) throw new InvalidRouteError(source, `duplicate parameter name ${name}`);
      parameterNames.push(name);
      signatureSegments.push(":");
      regexSegments.push("([^/]+)");
    } else {
      if (segment.includes(":")) throw new InvalidRouteError(source, "parameters must occupy an entire path segment");
      staticSegments += segment ? 1 : 0;
      signatureSegments.push(segment);
      regexSegments.push(escapeRegex(segment));
    }
  }

  return {
    apiKey,
    api,
    method,
    route: routePath,
    parameterNames,
    regex: new RegExp(`^${regexSegments.join("/")}$`, "u"),
    segments: signatureSegments,
    staticSegments,
    declarationOrder,
  };
}

function methodsOverlap(left: string | null, right: string | null): boolean {
  return left === null || right === null || left === right;
}

function pathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === ":" || right[index] === ":" || segment === right[index])
  );
}

function hasEqualPrecedence<Api extends RouteApiConfig>(left: CompiledRoute<Api>, right: CompiledRoute<Api>): boolean {
  return left.staticSegments === right.staticSegments && Boolean(left.method) === Boolean(right.method);
}

function decodeParameters(
  route: CompiledRoute<RouteApiConfig>,
  match: RegExpMatchArray,
): Record<string, string> | null {
  const result: Record<string, string> = {};
  try {
    for (const [index, name] of route.parameterNames.entries()) result[name] = decodeURIComponent(match[index + 1]);
    return result;
  } catch {
    return null;
  }
}

export class RouteTable<Api extends RouteApiConfig> {
  readonly #routes: readonly CompiledRoute<Api>[];

  constructor(apis: Readonly<Record<string, Api>>) {
    const routes: CompiledRoute<Api>[] = [];
    let declarationOrder = 0;
    for (const [apiKey, api] of Object.entries(apis)) {
      for (const route of api.routes) routes.push(compileRoute(apiKey, api, route, declarationOrder++));
    }

    for (const [index, route] of routes.entries()) {
      for (const other of routes.slice(index + 1)) {
        if (
          pathsOverlap(route.segments, other.segments) &&
          methodsOverlap(route.method, other.method) &&
          hasEqualPrecedence(route, other)
        ) {
          throw new AmbiguousRouteError(
            `${route.apiKey}: ${route.method ? `${route.method} ` : ""}${route.route}`,
            `${other.apiKey}: ${other.method ? `${other.method} ` : ""}${other.route}`,
          );
        }
      }
    }

    this.#routes = routes.sort(
      (left, right) =>
        right.staticSegments - left.staticSegments ||
        Number(Boolean(right.method)) - Number(Boolean(left.method)) ||
        left.declarationOrder - right.declarationOrder,
    );
  }

  match(method: string, pathname: string): RouteMatch<Api> | null {
    const normalizedMethod = method.toUpperCase();
    for (const route of this.#routes) {
      if (route.method && route.method !== normalizedMethod) continue;
      const match = pathname.match(route.regex);
      if (!match) continue;
      const pathParams = decodeParameters(route, match);
      if (!pathParams) return null;
      return {
        apiKey: route.apiKey,
        api: route.api,
        method: route.method,
        route: route.route,
        pathParams,
      };
    }
    return null;
  }
}
