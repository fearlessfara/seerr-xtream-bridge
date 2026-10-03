import { describe, expect, it } from 'vitest';
import { SeerrClient } from '../../src/clients/seerr.js';
import type { AppConfig } from '../../src/config.js';

const mediaResponse = {
  id: 67,
  tmdbId: 78,
  status: 5,
  mediaType: 'movie',
  seasons: [],
};

function createClient(capture: { body?: unknown; url?: string }) {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    capture.url = String(input);
    capture.body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify(mediaResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return new SeerrClient(
    {
      SEERR_URL: 'http://seerr.test',
      SEERR_API_KEY: 'key',
      HTTP_TIMEOUT_MS: 5000,
    } as AppConfig,
    fetchImpl,
  );
}

describe('SeerrClient.markMediaAvailable', () => {
  it('movie non-4K sends boolean false and omits seasons', async () => {
    const capture: { body?: unknown } = {};
    await createClient(capture).markMediaAvailable(67, { is4k: false });
    expect(capture.body).toEqual({ is4k: false });
    expect(capture.body).not.toHaveProperty('seasons');
    expect(typeof (capture.body as { is4k: unknown }).is4k).toBe('boolean');
  });

  it('movie 4K sends boolean true and omits seasons', async () => {
    const capture: { body?: unknown } = {};
    await createClient(capture).markMediaAvailable(67, { is4k: true });
    expect(capture.body).toEqual({ is4k: true });
    expect(capture.body).not.toHaveProperty('seasons');
  });

  it('TV sends boolean is4k plus seasons array', async () => {
    const capture: { body?: unknown; url?: string } = {};
    await createClient(capture).markMediaAvailable(67, {
      is4k: false,
      seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
    });
    expect(capture.url).toContain('/api/v1/media/67/available');
    expect(capture.body).toEqual({
      is4k: false,
      seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
    });
    expect(typeof (capture.body as { is4k: unknown }).is4k).toBe('boolean');
  });

  it('never stringifies is4k', async () => {
    const capture: { body?: unknown } = {};
    await createClient(capture).markMediaAvailable(67, { is4k: false });
    expect((capture.body as { is4k: unknown }).is4k).not.toBe('false');
    expect((capture.body as { is4k: unknown }).is4k).not.toBe('true');
  });
});
