import { spawn, type ChildProcess } from 'node:child_process';
import type { AppConfig } from '../config.js';
import { FfprobeJsonSchema } from '../clients/schemas/ffprobe.js';
import { classifyResolutionFromDims } from '../domain/quality/resolution.js';
import { normalizeLanguageTag } from '../domain/quality/language.js';
import type { ClassifiedResolution } from '../domain/quality/resolution.js';
import { BridgeError } from '../lib/errors.js';

const RESERVED_ROUTES = new Set(['full', 'live', 'movie', 'series', 'api', 'static', 'merged']);

export interface ProbeAudioTrack {
  codec?: string;
  channels?: number;
  language?: string;
  title?: string;
}

export interface ProbeVideoInfo {
  codec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
}

export interface MediaProbeResult {
  ok: true;
  durationSeconds?: number;
  formatBitrate?: number;
  video?: ProbeVideoInfo;
  audioTracks: ProbeAudioTrack[];
  resolution?: ClassifiedResolution;
  /** Safe diagnostic fields — never includes credentials. */
  diagnostics: {
    exitCode: number;
    stderrSnippet?: string;
  };
}

export interface MediaProbeFailure {
  ok: false;
  reason: string;
  diagnostics: {
    exitCode?: number | null;
    timedOut?: boolean;
    stderrSnippet?: string;
  };
}

export type MediaProbeOutcome = MediaProbeResult | MediaProbeFailure;

export interface FfprobeExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type FfprobeExecutor = (
  binary: string,
  args: readonly string[],
  opts: { timeoutMs: number },
) => Promise<FfprobeExecResult>;

function toNumber(v: string | number | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function sanitizeSourceRoute(route: string): string {
  const r = route.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(r) || RESERVED_ROUTES.has(r)) {
    throw new BridgeError(`Invalid XtreamFilter source route: ${route}`, {
      errorClass: 'permanent',
    });
  }
  return r;
}

export function sanitizeStreamId(streamId: string): string {
  const id = String(streamId).trim();
  if (!/^\d{1,18}$/.test(id)) {
    throw new BridgeError(`Invalid stream id for probe: ${streamId}`, { errorClass: 'permanent' });
  }
  return id;
}

export function sanitizeContainerExtension(ext?: string | null): string {
  const e = (ext ?? '').trim().toLowerCase().replace(/^\./, '');
  if (!e || !/^[a-z0-9]{1,8}$/.test(e)) {
    throw new BridgeError(`Missing/invalid container_extension for probe (got ${ext ?? 'empty'})`, {
      errorClass: 'permanent',
    });
  }
  return e;
}

/** Sanitize when present; return undefined to omit the field (never invent an extension). */
export function optionalContainerExtension(ext?: string | null): string | undefined {
  if (ext == null || !String(ext).trim()) return undefined;
  try {
    return sanitizeContainerExtension(ext);
  } catch {
    return undefined;
  }
}

/**
 * Build XtreamFilter source-specific VOD proxy URL.
 * Uses literal user/pass placeholders accepted by XtreamFilter — not provider credentials.
 */
export function buildXtreamVodProxyUrl(input: {
  baseUrl: string;
  sourceRoute: string;
  streamId: string;
  containerExtension?: string | null;
}): string {
  const base = input.baseUrl.replace(/\/+$/, '');
  const route = sanitizeSourceRoute(input.sourceRoute);
  const streamId = sanitizeStreamId(input.streamId);
  const ext = sanitizeContainerExtension(input.containerExtension);
  return `${base}/${route}/movie/user/pass/${streamId}.${ext}`;
}

/** Redact user/pass path segments for logging. */
export function redactProbeUrl(url: string): string {
  return url.replace(/\/movie\/[^/]+\/[^/]+\//i, '/movie/***/***/');
}

export const FFPROBE_SHOW_ENTRIES =
  'format=duration,bit_rate:stream=index,codec_name,codec_type,width,height,bit_rate,channels:stream_tags=language,title';

export function buildFfprobeArgs(url: string): string[] {
  return [
    '-v',
    'error',
    '-probesize',
    '5000000',
    '-analyzeduration',
    '10000000',
    '-show_entries',
    FFPROBE_SHOW_ENTRIES,
    '-of',
    'json',
    url,
  ];
}

export const defaultFfprobeExecutor: FfprobeExecutor = (binary, args, opts) =>
  new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const child: ChildProcess = spawn(binary, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) stdout = stdout.slice(0, 2_000_000);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 64_000) stderr = stderr.slice(0, 64_000);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });

export function parseFfprobeOutput(stdout: string): MediaProbeResult {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error('ffprobe stdout is not valid JSON');
  }
  const parsed = FfprobeJsonSchema.parse(json);
  const videoStream = parsed.streams.find((s) => (s.codec_type ?? '').toLowerCase() === 'video');
  if (!videoStream) {
    throw new Error('ffprobe output has no video stream');
  }

  const width = videoStream.width;
  const height = videoStream.height;
  const videoBitrate = toNumber(videoStream.bit_rate);
  const formatBitrate = toNumber(parsed.format?.bit_rate);
  const durationSeconds = toNumber(parsed.format?.duration);
  const resolution = classifyResolutionFromDims(width, height);

  const audioTracks: ProbeAudioTrack[] = parsed.streams
    .filter((s) => (s.codec_type ?? '').toLowerCase() === 'audio')
    .map((s) => ({
      codec: s.codec_name,
      channels: s.channels,
      language: normalizeLanguageTag(s.tags?.language),
      title: s.tags?.title,
    }));

  return {
    ok: true,
    durationSeconds,
    formatBitrate,
    video: {
      codec: videoStream.codec_name,
      width,
      height,
      bitrate: videoBitrate ?? formatBitrate,
    },
    audioTracks,
    resolution,
    diagnostics: { exitCode: 0 },
  };
}

export class XtreamMediaProbe {
  private readonly executor: FfprobeExecutor;
  private active = 0;

  constructor(
    private readonly config: Pick<
      AppConfig,
      'XTREAMFILTER_URL' | 'FFPROBE_PATH' | 'XTREAM_PROBE_TIMEOUT_MS'
    >,
    executor: FfprobeExecutor = defaultFfprobeExecutor,
  ) {
    this.executor = executor;
  }

  /** Test/observability helper: true while a probe child is running. */
  get concurrentProbes(): number {
    return this.active;
  }

  buildVodUrl(input: {
    sourceRoute: string;
    streamId: string;
    containerExtension?: string | null;
  }): string {
    return buildXtreamVodProxyUrl({
      baseUrl: this.config.XTREAMFILTER_URL,
      sourceRoute: input.sourceRoute,
      streamId: input.streamId,
      containerExtension: input.containerExtension,
    });
  }

  async probeUrl(url: string): Promise<MediaProbeOutcome> {
    if (this.active > 0) {
      return {
        ok: false,
        reason: 'probe_concurrency_guard',
        diagnostics: {},
      };
    }
    this.active += 1;
    try {
      const args = buildFfprobeArgs(url);
      const result = await this.executor(this.config.FFPROBE_PATH, args, {
        timeoutMs: this.config.XTREAM_PROBE_TIMEOUT_MS,
      });

      const stderrSnippet = result.stderr.trim().slice(0, 500) || undefined;

      if (result.timedOut) {
        return {
          ok: false,
          reason: 'ffprobe_timeout',
          diagnostics: { timedOut: true, exitCode: result.code, stderrSnippet },
        };
      }
      if (result.code !== 0) {
        return {
          ok: false,
          reason: `ffprobe_exit_${result.code ?? 'null'}`,
          diagnostics: { exitCode: result.code, stderrSnippet },
        };
      }
      try {
        const parsed = parseFfprobeOutput(result.stdout);
        return {
          ...parsed,
          diagnostics: { exitCode: 0, stderrSnippet },
        };
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : 'ffprobe_parse_failed',
          diagnostics: { exitCode: result.code, stderrSnippet },
        };
      }
    } finally {
      this.active -= 1;
    }
  }

  async probeVodCandidate(input: {
    sourceRoute: string;
    streamId: string;
    containerExtension?: string | null;
  }): Promise<{ urlRedacted: string; outcome: MediaProbeOutcome }> {
    let url: string;
    try {
      url = this.buildVodUrl(input);
    } catch (err) {
      return {
        urlRedacted: '(invalid)',
        outcome: {
          ok: false,
          reason: err instanceof Error ? err.message : 'invalid_probe_url',
          diagnostics: {},
        },
      };
    }
    const outcome = await this.probeUrl(url);
    return { urlRedacted: redactProbeUrl(url), outcome };
  }
}

export async function assertFfprobeAvailable(binary: string): Promise<void> {
  const result = await defaultFfprobeExecutor(binary, ['-version'], { timeoutMs: 5_000 });
  if (result.timedOut || result.code !== 0) {
    throw new Error(
      `ffprobe not available at "${binary}" (exit=${result.code}, timedOut=${result.timedOut}). Install ffmpeg/ffprobe in the runtime image.`,
    );
  }
}
