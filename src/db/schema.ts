import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const requests = sqliteTable(
  'requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seerrRequestId: integer('seerr_request_id').notNull(),
    mediaType: text('media_type').notNull(),
    tmdbId: integer('tmdb_id').notNull(),
    tvdbId: integer('tvdb_id'),
    is4k: integer('is_4k', { mode: 'boolean' }).notNull().default(false),
    requester: text('requester'),
    seasonsJson: text('seasons_json'),
    rawWebhookJson: text('raw_webhook_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('requests_seerr_request_id_uidx').on(t.seerrRequestId)],
);

export const requestScopes = sqliteTable(
  'request_scopes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestId: integer('request_id')
      .notNull()
      .references(() => requests.id),
    idempotencyKey: text('idempotency_key').notNull(),
    scopeType: text('scope_type').notNull(),
    seasonNumber: integer('season_number'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('request_scopes_idem_uidx').on(t.idempotencyKey)],
);

export const acquisitionJobs = sqliteTable('acquisition_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: integer('request_id')
    .notNull()
    .references(() => requests.id),
  state: text('state').notNull(),
  mediaType: text('media_type').notNull(),
  tmdbId: integer('tmdb_id').notNull(),
  matchKind: text('match_kind'),
  errorClass: text('error_class'),
  errorMessage: text('error_message'),
  arrServerId: integer('arr_server_id'),
  arrProfileId: integer('arr_profile_id'),
  arrProfileName: text('arr_profile_name'),
  arrType: text('arr_type'),
  qualityResolutionSnapshot: text('quality_resolution_snapshot'),
  qualityDecision: text('quality_decision'),
  jellyfinVerifiedAt: text('jellyfin_verified_at'),
  availabilityGraceUntil: text('availability_grace_until'),
  completionGraceUntil: text('completion_grace_until'),
  nextAttemptAt: text('next_attempt_at'),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const xtreamItems = sqliteTable('xtream_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id')
    .notNull()
    .references(() => acquisitionJobs.id),
  sourceId: text('source_id').notNull(),
  streamId: text('stream_id'),
  seriesId: text('series_id'),
  seasonNumber: integer('season_number'),
  cartItemIdsJson: text('cart_item_ids_json'),
  status: text('status').notNull().default('pending'),
  name: text('name'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id')
    .notNull()
    .references(() => acquisitionJobs.id),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  reason: text('reason'),
  metaJson: text('meta_json'),
  createdAt: text('created_at').notNull(),
});

export const operations = sqliteTable(
  'operations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operationKey: text('operation_key').notNull(),
    jobId: integer('job_id').references(() => acquisitionJobs.id),
    status: text('status').notNull(),
    requestJson: text('request_json'),
    resultJson: text('result_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('operations_key_uidx').on(t.operationKey)],
);

export type RequestRow = typeof requests.$inferSelect;
export type JobRow = typeof acquisitionJobs.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type OperationRow = typeof operations.$inferSelect;
