/**
 * API response helpers
 * Standardized error response creators for control-api
 */

/**
 * API error response structure
 */
export interface ApiError {
  error: string;
  details?: string;
  resource?: string;
  name?: string;
}

/**
 * Capitalize first letter
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Create a 404 Not Found error response
 */
export function notFoundError(resource: string, name: string): ApiError {
  return {
    error: "Not found",
    resource,
    name,
  };
}

/**
 * Create a 400 Validation error response
 */
export function validationError(details: string): ApiError {
  return {
    error: "Invalid request",
    details,
  };
}

/**
 * Create a 409 Conflict error response
 */
export function conflictError(resource: string, name: string): ApiError {
  return {
    error: `${capitalize(resource)} already exists`,
    name,
  };
}

/**
 * Create a 500 Internal Server Error response
 */
export function internalError(message: string): ApiError {
  return {
    error: "Internal server error",
    details: message,
  };
}
