# Upstream API Analysis

Evidence-based notes for `seerr-xtream-bridge`. Prefer these citations over prompt assumptions.

Sources researched:

- [seerr-team/seerr](https://github.com/seerr-team/seerr) `@develop`
- [SpanishST/xtreamfilter](https://github.com/SpanishST/xtreamfilter) `0.5.14` (`master`)
- [Radarr/Radarr](https://github.com/Radarr/Radarr) OpenAPI `src/Radarr.Api.V3/openapi.json`
- [Sonarr/Sonarr](https://github.com/Sonarr/Sonarr) OpenAPI `src/Sonarr.Api.V3/openapi.json`

---

## 1. Seerr

### 1.1 Authentication

| Mechanism   | Details                                            | Evidence                                             |
| ----------- | -------------------------------------------------- | ---------------------------------------------------- |
| API key     | Header `X-Api-Key` equals `settings.main.apiKey`   | `server/middleware/auth.ts`, OpenAPI `seerr-api.yml` |
| Permissions | Approve / mark-available require `MANAGE_REQUESTS` | `server/routes/request.ts`, `server/routes/media.ts` |

### 1.2 Request status machine

`server/constants/media.ts`:

```ts
enum MediaRequestStatus {
  PENDING = 1,
  APPROVED, // 2
  DECLINED, // 3
  FAILED, // 4
  COMPLETED, // 5
}

enum MediaStatus {
  UNKNOWN = 1,
  PENDING,
  PROCESSING,
  PARTIALLY_AVAILABLE,
  AVAILABLE,
  BLOCKLISTED,
  DELETED,
}
```

Users without `AUTO_APPROVE*` / `MANAGE_REQUESTS` create `PENDING` requests (`MediaRequest.createRequest`).

### 1.3 Webhooks

| Item          | Behaviour                                                                  | Evidence                                          |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Delivery      | Outbound `axios.post(webhookUrl, payload, { headers })`                    | `server/lib/notifications/agents/webhook.ts`      |
| Secret        | **No HMAC**. Optional `authHeader` → `Authorization`, plus `customHeaders` | same                                              |
| Pending event | `MEDIA_PENDING` after insert when status is PENDING                        | `MediaRequest` `@AfterInsert` / notification enum |
| Payload       | Templated JSON with `notification_type`, `media`, `request`, `extra`       | default in `server/lib/settings/index.ts`         |

Typical pending movie body (after template key rewrite):

```json
{
  "notification_type": "MEDIA_PENDING",
  "event": "New Movie Request",
  "subject": "Title (2024)",
  "media": {
    "media_type": "movie",
    "tmdbId": "123",
    "tvdbId": "",
    "status": "PENDING",
    "status4k": "UNKNOWN"
  },
  "request": {
    "request_id": "42",
    "requestedBy_username": "user"
  },
  "extra": []
}
```

TV adds `extra: [{ "name": "Requested Seasons", "value": "1, 2" }]`. Season scope is **not** episode-level.

### 1.4 Approve / mark available

| Operation      | Endpoint                            | Notes                                             |
| -------------- | ----------------------------------- | ------------------------------------------------- |
| Approve        | `POST /api/v1/request/{id}/approve` | Only `PENDING` else 409; triggers *arr subscriber |
| Decline        | `POST /api/v1/request/{id}/decline` |                                                   |
| Get request    | `GET /api/v1/request/{id}`          | Raw entity JSON                                   |
| Mark available | `POST /api/v1/media/{id}/available` | Body `{ seasons?: [{seasonNumber}], is4k? }`      |

### 1.5 When *arr is skipped

`MediaRequestSubscriber.sendToRadarr` / `sendToSonarr`: if media `status(4k) === AVAILABLE`, mark request `COMPLETED` and **do not** call Radarr/Sonarr.

`PARTIALLY_AVAILABLE` does **not** skip *arr.

### 1.6 Auto-complete / auto-approve from media

`MediaSubscriber`:

- Media `PENDING → AVAILABLE` → related PENDING requests set to `APPROVED` (`updateChildRequestStatus`)
- Media/seasons become AVAILABLE → APPROVED/FAILED requests may become `COMPLETED` (`updateRelatedMediaRequest`)

Bridge implication: after Jellyfin-verified availability, prefer letting Seerr’s subscriber lifecycle finish. Manual approve is reconciliation-only after a grace period, and only when media is already AVAILABLE.

### 1.7 Quality intent on requests

Persisted on `MediaRequest` (`server/entity/MediaRequest.ts`):

| Field               | Type             | Notes                                |
| ------------------- | ---------------- | ------------------------------------ |
| `serverId`          | number \| null   | *arr server index in Seerr settings  |
| `profileId`         | number \| null   | Quality profile id on that server    |
| `is4k`              | boolean          | Selects 4K vs non-4K server defaults |
| `rootFolder`        | string \| null   | Path                                 |
| `tags`              | number[] \| null |                                      |
| `languageProfileId` | number \| null   | TV                                   |

`profileName` is **not** stored; list endpoint may enrich it from live *arr APIs. GET-by-id returns ids only.

Defaults when null: applied at approve time from default `isDefault && is4k` server’s `activeProfileId` / `activeDirectory` / tags (`MediaRequestSubscriber`).

### 1.8 Seerr *arr settings / service APIs

| Endpoint                         | Returns                                               |
| -------------------------------- | ----------------------------------------------------- |
| `GET /api/v1/settings/radarr`    | Full Radarr server configs (incl. apiKey) — ADMIN     |
| `GET /api/v1/settings/sonarr`    | Full Sonarr server configs — ADMIN                    |
| `GET /api/v1/service/radarr/:id` | `{ profiles: [{id,name}], rootFolders, tags }` — slim |

Bridge must fetch the **full** quality ladder from Radarr/Sonarr, not from Seerr’s slim profile list.

### 1.9 Jellyfin availability in Seerr

`server/lib/scanners/jellyfin/index.ts` + `baseScanner.ts`: movies matched via ProviderIds (Tmdb/…); seasons AVAILABLE when episode count equals TMDB total.

---

## 2. XtreamFilter

Stack: FastAPI (`app/main.py`), default port 5000. REST is **unauthenticated**.

### 2.1 Lookup

| Endpoint                                                | Use                                   |
| ------------------------------------------------------- | ------------------------------------- |
| `GET /api/browse?search=tmdb:{id}&type=vod\|series`     | Primary TMDb lookup (`browse_api.py`) |
| `GET /api/monitor/movie-lookup?q=tmdb:{id}`             | Alternate                             |
| `GET /api/monitor/series-lookup?tmdb_id=`               | Alternate                             |
| `GET /api/cart/series-episodes/{source_id}/{series_id}` | Season/episode structure              |

Browse items expose `tmdb_id`, `source_id`, `id` (stream/series id), `name`, `source_name`.

### 2.2 Cart / download

| Endpoint               | Use                                |
| ---------------------- | ---------------------------------- |
| `POST /api/cart`       | Add vod / series season / episodes |
| `POST /api/cart/batch` | Batch                              |
| `GET /api/cart`        | List items                         |
| `GET /api/cart/status` | Queue status                       |
| `POST /api/cart/start` | Start worker                       |

Movie body: `{ content_type:"vod", source_id, stream_id, name, … }`  
Season: `{ content_type:"series", add_mode:"season", series_id, season_num, … }`

Duplicate active item → HTTP **409** `"Item already in cart"`. Bridge must verify cart tuple presence before treating 409 as success.

Cart/history rows **do not** include `tmdb_id`. Bridge stores mapping.

### 2.3 Jellyfin from XtreamFilter

Optional config; after download may `POST {jellyfin}/Library/Refresh`. Bridge still verifies via Jellyfin Items API.

### 2.4 max_connections

Stored on sources; **not enforced** by the sequential download worker. UI warning only. Does not coordinate with Dispatcharr.

---

## 3. Radarr / Sonarr quality APIs

Auth: `X-Api-Key` header.

| Endpoint                          | Purpose                       |
| --------------------------------- | ----------------------------- |
| `GET /api/v3/qualityprofile`      | All profiles                  |
| `GET /api/v3/qualityprofile/{id}` | Single profile                |
| `GET /api/v3/qualitydefinition`   | Quality metadata / size hints |
| `GET /api/v3/customformat`        | Custom format definitions     |

### 3.1 QualityProfile shape (both)

Key fields: `id`, `name`, `upgradeAllowed`, `cutoff`, `items[]`, `minFormatScore`, `cutoffFormatScore`, `formatItems[]`.

Nested `items`:

- Leaf: `{ quality: { id, name, source, resolution, modifier? }, allowed, items: [] }`
- Group: `{ id, name: "WEB 1080p", allowed, items: [leaves…] }` (`quality` null)

Radarr adds profile `language` and quality `modifier` (e.g. remux). Sonarr omits those; remux quality ids differ.

### 3.2 Custom formats

Definitions at `/customformat` (name + specifications). Scores live on profile `formatItems[].score`, thresholds on `minFormatScore`.

### 3.3 Observable against Xtream

| Can often evaluate                            | Usually cannot                  |
| --------------------------------------------- | ------------------------------- |
| Allowed resolutions from `quality.resolution` | Exact WEBDL vs Bluray vs WEBRip |
| Cutoff preference among known resolutions     | Full CF scoring engine          |
| HDR/codec **if** title/meta tokens exist      | Release group / proper / repack |

Bridge must not invent source/CF matches from bare titles.

### 3.4 Recyclarr

Recyclarr syncs TRaSH guides into Radarr/Sonarr. It is **not** a bridge runtime dependency. Profile changes appear via Radarr/Sonarr APIs after refresh/TTL.

---

## 4. Jellyfin (bridge verification)

| Operation          | API                                                       |
| ------------------ | --------------------------------------------------------- |
| Refresh            | `POST /Library/Refresh` with `X-Emby-Token`               |
| Search by provider | `GET /Items?AnyProviderIdEquals=Tmdb.{id}` (and variants) |
| TV episodes        | Item tree / `GET /Shows/{id}/Episodes`                    |

Bridge invariant: **Jellyfin** is the source of truth that media exists. XtreamFilter cart completion alone is insufficient.

---

## 5. Bridge-relevant invariants

1. Keep Seerr requesters without auto-approve so webhooks are `MEDIA_PENDING`.
2. Never approve into *arr unless media is AVAILABLE (Xtream path) or intentional fallback.
3. Manual approve on Xtream-success path is reconciliation-only after grace.
4. Fallback must approve the **original** request (preserve profile/server).
5. TV is season-scoped; `all_or_nothing` for episode coverage.
6. Identity match outranks quality score.
7. Profile API failures are retryable, not immediate fallback.
