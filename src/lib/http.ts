import type { ZodType } from 'zod';
import { BridgeError, classifyHttpError, redactSecrets } from './errors.js';

export type FetchLike = typeof fetch;

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  defaultHeaders?: Record<string, string>;
  fetchImpl?: FetchLike;
  serviceName: string;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: FetchLike;
  private readonly serviceName: string;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs;
    this.defaultHeaders = opts.defaultHeaders ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.serviceName = opts.serviceName;
  }

  async request<T>(
    method: string,
    path: string,
    opts?: {
      query?: Record<string, string | number | boolean | undefined | null>;
      body?: unknown;
      headers?: Record<string, string>;
      schema?: ZodType<T>;
      allowStatuses?: number[];
    },
  ): Promise<{ status: number; data: T; headers: Headers }> {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (opts?.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...this.defaultHeaders,
          ...(opts?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts?.headers,
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let json: unknown = undefined;
      if (text) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = text;
        }
      }

      const allowed = opts?.allowStatuses ?? [];
      if (!res.ok && !allowed.includes(res.status)) {
        throw new BridgeError(`${this.serviceName} HTTP ${res.status} ${method} ${path}`, {
          errorClass: classifyHttpError(res.status),
          statusCode: res.status,
          details: redactSecrets(json),
        });
      }

      let data = json as T;
      if (opts?.schema) {
        const parsed = opts.schema.safeParse(json);
        if (!parsed.success) {
          throw new BridgeError(
            `${this.serviceName} response schema mismatch for ${method} ${path}`,
            {
              errorClass: 'permanent',
              statusCode: res.status,
              details: {
                issues: parsed.error.issues,
                body: redactSecrets(json),
              },
            },
          );
        }
        data = parsed.data;
      }

      return { status: res.status, data, headers: res.headers };
    } catch (err) {
      if (err instanceof BridgeError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new BridgeError(`${this.serviceName} request timed out`, {
          errorClass: 'retryable',
          cause: err,
        });
      }
      throw new BridgeError(`${this.serviceName} request failed`, {
        errorClass: 'retryable',
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
