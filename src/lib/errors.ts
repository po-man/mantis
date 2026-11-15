export type ErrorCode =
  | "bad_request"
  | "invalid_image"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_svg"
  | "upstream_error"
  | "upstream_timeout"
  | "rate_limited"
  | "config_error"
  | "not_found"
  | "internal_error";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
