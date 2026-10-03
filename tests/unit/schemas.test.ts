import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ArrQualityProfileSchema } from '../../src/clients/schemas/radarr-sonarr.js';
import { JellyfinItemsResponseSchema } from '../../src/clients/schemas/jellyfin.js';
import { SeerrRequestSchema, SeerrWebhookSchema } from '../../src/clients/schemas/seerr.js';
import { XtreamBrowseResponseSchema } from '../../src/clients/schemas/xtreamfilter.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

describe('fixture schema parsing', () => {
  it('parses seerr webhook', () => {
    const raw = JSON.parse(readFileSync(join(root, 'seerr/webhook-movie-pending.json'), 'utf8'));
    expect(SeerrWebhookSchema.parse(raw).notification_type).toBe('MEDIA_PENDING');
  });

  it('parses seerr request', () => {
    const raw = JSON.parse(readFileSync(join(root, 'seerr/request-movie-pending.json'), 'utf8'));
    expect(SeerrRequestSchema.parse(raw).profileId).toBe(4);
  });

  it('parses radarr profile', () => {
    const raw = JSON.parse(readFileSync(join(root, 'radarr/qualityprofile-hd.json'), 'utf8'));
    expect(ArrQualityProfileSchema.parse(raw).name).toContain('HD');
  });

  it('parses sonarr profile', () => {
    const raw = JSON.parse(readFileSync(join(root, 'sonarr/qualityprofile-hd.json'), 'utf8'));
    expect(ArrQualityProfileSchema.parse(raw).id).toBe(6);
  });

  it('parses xtream browse flat', () => {
    const raw = JSON.parse(readFileSync(join(root, 'xtreamfilter/browse-movie.json'), 'utf8'));
    expect(XtreamBrowseResponseSchema.parse(raw).items.length).toBe(2);
  });

  it('parses xtream browse grouped:true with nested items', () => {
    const raw = JSON.parse(
      readFileSync(join(root, 'xtreamfilter/browse-zootopia-grouped.json'), 'utf8'),
    );
    const parsed = XtreamBrowseResponseSchema.parse(raw);
    expect(parsed.grouped).toBe(true);
    expect(parsed.items).toHaveLength(1);
  });

  it('parses jellyfin items', () => {
    const raw = JSON.parse(readFileSync(join(root, 'jellyfin/movie-items.json'), 'utf8'));
    expect(JellyfinItemsResponseSchema.parse(raw).Items[0].ProviderIds.Tmdb).toBe('693134');
  });

  it('fails loudly on incompatible payloads', () => {
    expect(() => SeerrRequestSchema.parse({ id: 'nope' })).toThrow();
  });
});
