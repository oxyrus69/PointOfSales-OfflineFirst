/**
 * Service errors carry an HTTP-ish status so both Server Actions and Route
 * Handlers can turn them into a consistent payload without leaking internals.
 */
export class ServiceError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "SERVICE_ERROR") {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
  }
}

export function throwServiceError(message: string, status = 400, code = "SERVICE_ERROR"): never {
  throw new ServiceError(message, status, code);
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; code?: string; status?: number };

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(error: unknown): { ok: false; error: string; code?: string; status?: number } {
  if (error instanceof ServiceError) {
    return { ok: false, error: error.message, code: error.code, status: error.status };
  }
  if (error instanceof Error) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "Terjadi kesalahan tak terduga." };
}
