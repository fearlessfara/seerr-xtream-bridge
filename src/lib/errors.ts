export type ErrorClass = 'retryable' | 'permanent';

export class BridgeError extends Error {
  readonly errorClass: ErrorClass;
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    opts: { errorClass: ErrorClass; statusCode?: number; details?: unknown; cause?: unknown },
  ) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'BridgeError';
    this.errorClass = opts.errorClass;
    this.statusCode = opts.statusCode;
    this.details = opts.details;
  }
}

export function classifyHttpError(status: number): ErrorClass {
  if (status === 429 || status >= 500) return 'retryable';
  if (status === 408) return 'retryable';
  return 'permanent';
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof BridgeError) return err.errorClass === 'retryable';
  if (err instanceof TypeError) return true; // fetch network failures
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('fetch failed')) {
      return true;
    }
  }
  return false;
}

const SECRET_KEYS = /api[_-]?key|password|authorization|token|secret/i;

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length > 24 && /^[A-Za-z0-9+/=._-]{20,}$/.test(value)) {
      return '[REDACTED]';
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}
