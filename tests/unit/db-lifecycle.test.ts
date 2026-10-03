import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/client.js';
import { BridgeRepository } from '../../src/db/repository.js';

describe('sqlite open/use/close lifecycle', () => {
  it('opens, uses, and closes cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-db-'));
    const path = join(dir, 'lifecycle.db');
    const { db, sqlite, close } = openDatabase(path);

    expect(sqlite.open).toBe(true);
    const repo = new BridgeRepository(db);
    const { job } = repo.createRequestWithJob({
      seerrRequestId: 99,
      mediaType: 'movie',
      tmdbId: 1,
      is4k: false,
      seasons: [],
      rawWebhook: {},
    });
    expect(job.id).toBeGreaterThan(0);
    expect(repo.getJob(job.id)?.state).toBe('RECEIVED');

    close();
    expect(sqlite.open).toBe(false);
  });

  it('close is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-db-'));
    const { sqlite, close } = openDatabase(join(dir, 'idempotent.db'));
    close();
    close();
    expect(sqlite.open).toBe(false);
  });

  it('rejects use after close', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-db-'));
    const { db, close } = openDatabase(join(dir, 'after-close.db'));
    const repo = new BridgeRepository(db);
    close();
    expect(() =>
      repo.createRequestWithJob({
        seerrRequestId: 1,
        mediaType: 'movie',
        tmdbId: 1,
        is4k: false,
        seasons: [],
        rawWebhook: {},
      }),
    ).toThrow();
  });
});
