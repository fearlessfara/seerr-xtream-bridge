import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/client.js';
import { BridgeRepository } from '../../src/db/repository.js';

describe('persisted state transitions', () => {
  it('writes event with every transition in one transaction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-'));
    const { db, sqlite } = openDatabase(join(dir, 't.db'));
    const repo = new BridgeRepository(db);
    const { job } = repo.createRequestWithJob({
      seerrRequestId: 1,
      mediaType: 'movie',
      tmdbId: 10,
      is4k: false,
      seasons: [],
      rawWebhook: {},
    });
    repo.transitionJob(job.id, 'VALIDATING', { reason: 'test' });
    const events = repo.listEvents(job.id);
    expect(events.map((e) => e.toState)).toEqual(['RECEIVED', 'VALIDATING']);
    expect(events[1].fromState).toBe('RECEIVED');
    sqlite.close();
  });

  it('enforces unique operation keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-'));
    const { db, sqlite } = openDatabase(join(dir, 't.db'));
    const repo = new BridgeRepository(db);
    const { job } = repo.createRequestWithJob({
      seerrRequestId: 2,
      mediaType: 'movie',
      tmdbId: 11,
      is4k: false,
      seasons: [],
      rawWebhook: {},
    });
    const a = repo.beginOperation('queue:seerr:2:movie:11', job.id, {});
    const b = repo.beginOperation('queue:seerr:2:movie:11', job.id, {});
    expect(a?.id).toBe(b?.id);
    sqlite.close();
  });
});
