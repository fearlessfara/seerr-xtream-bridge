import type { AppConfig } from '../../config.js';
import type { JellyfinClient } from '../../clients/jellyfin.js';
import type { SeerrClient } from '../../clients/seerr.js';
import type { SeerrRequest } from '../../clients/schemas/seerr.js';
import type { XtreamFilterClient } from '../../clients/xtreamfilter.js';
import { matchMedia } from '../../domain/matching/matcher.js';
import type { MatchCandidate } from '../../domain/matching/types.js';
import { evaluateCandidateQuality, pickBestCompatible } from '../../domain/quality/evaluator.js';
import { parseXtreamQuality } from '../../domain/quality/parser.js';
import { mergeProbeIntoQuality } from '../../domain/quality/probe-merge.js';
import { buildProbeShortlist, shouldStopProbing } from '../../domain/quality/shortlist.js';
import type { QualityDecision, QualityEvaluation } from '../../domain/quality/types.js';
import { isTerminalState, type JobState } from '../../domain/state-machine/states.js';
import type { BridgeRepository } from '../../db/repository.js';
import type { JobRow, RequestRow } from '../../db/schema.js';
import { BridgeError, isRetryableError } from '../../lib/errors.js';
import type { Logger } from '../../logging/logger.js';
import type { Metrics } from '../../metrics/metrics.js';
import type { ProviderActivityService } from '../provider-activity.js';
import type { QualityProfileResolverService } from '../quality-profile-resolver.js';
import type { XtreamMediaProbe } from '../xtream-media-probe.js';

/** Seerr MediaRequestStatus */
const SEERR_PENDING = 1;
const SEERR_APPROVED = 2;
const SEERR_COMPLETED = 5;
/** Seerr MediaStatus */
const MEDIA_AVAILABLE = 5;
const MEDIA_PROCESSING = 3;

export class AcquisitionEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly repo: BridgeRepository,
    private readonly seerr: SeerrClient,
    private readonly xtream: XtreamFilterClient,
    private readonly jellyfin: JellyfinClient,
    private readonly qualityResolver: QualityProfileResolverService,
    private readonly providerActivity: ProviderActivityService,
    private readonly mediaProbe: XtreamMediaProbe,
    private readonly log: Logger,
    private readonly metrics?: Metrics,
  ) {}

  async processJob(jobId: number): Promise<void> {
    const job = this.repo.getJob(jobId);
    if (!job || isTerminalState(job.state as JobState)) return;

    if (job.state === 'FAILED_RETRYABLE' && job.nextAttemptAt) {
      if (Date.parse(job.nextAttemptAt) > Date.now()) return;
      this.repo.clearRetry(job.id, 'VALIDATING', 'retry_backoff_elapsed');
    }

    try {
      await this.step(job.id);
    } catch (err) {
      this.handleError(job.id, err);
    }
  }

  async reconcileAll(): Promise<number> {
    const active = this.repo.listActiveJobs();
    for (const job of active) {
      await this.processJob(job.id);
    }
    return active.length;
  }

  private handleError(jobId: number, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.log.error({ jobId, err: message }, 'job step failed');
    this.metrics?.jobsFailed.inc();
    if (isRetryableError(err)) {
      const job = this.repo.getJob(jobId);
      const attempt = (job?.attemptCount ?? 0) + 1;
      const delay = Math.min(300, 5 * 2 ** Math.min(attempt, 6));
      this.repo.markRetry(jobId, message, delay);
      return;
    }
    this.repo.transitionJob(jobId, 'FAILED_PERMANENT', {
      reason: 'permanent_error',
      meta: { message },
      patch: { errorClass: 'permanent', errorMessage: message },
    });
  }

  private async step(jobId: number): Promise<void> {
    const job = this.repo.getJob(jobId);
    if (!job) return;
    const request = this.repo.getRequest(job.requestId);
    if (!request) throw new BridgeError('Missing request row', { errorClass: 'permanent' });

    const ctx = {
      requestId: request.seerrRequestId,
      mediaType: job.mediaType,
      tmdbId: job.tmdbId,
      jobId: job.id,
      state: job.state,
    };

    switch (job.state as JobState) {
      case 'RECEIVED':
      case 'FAILED_RETRYABLE':
        this.repo.transitionJob(job.id, 'VALIDATING', { reason: 'start' });
        break;
      case 'VALIDATING':
        await this.validate(job, request);
        break;
      case 'CHECKING_JELLYFIN':
        await this.checkJellyfin(job, request, ctx);
        break;
      case 'CHECKING_SEERR_OWNERSHIP':
        await this.checkOwnership(job, request, ctx);
        break;
      case 'RESOLVING_QUALITY_PROFILE':
        await this.resolveQuality(job, request, ctx);
        break;
      case 'SEARCHING_XTREAM':
        await this.searchXtream(job, request, ctx);
        break;
      case 'EVALUATING_XTREAM_CANDIDATES':
        // handled inside searchXtream synchronously via transition; re-enter search if needed
        await this.searchXtream(job, request, ctx);
        break;
      case 'XTREAM_MATCHED':
      case 'XTREAM_QUEUING':
        await this.queueXtream(job, request, ctx);
        break;
      case 'XTREAM_QUEUED':
      case 'XTREAM_DOWNLOADING':
        await this.pollXtream(job, ctx);
        break;
      case 'WAITING_FOR_JELLYFIN':
        await this.waitJellyfin(job, request, ctx);
        break;
      case 'AVAILABLE':
      case 'COMPLETING_SEERR':
        await this.completeSeerr(job, request, ctx);
        break;
      case 'XTREAM_NOT_FOUND':
      case 'XTREAM_AMBIGUOUS':
      case 'FALLBACK_PENDING':
        this.repo.transitionJob(job.id, 'FALLBACK_APPROVING', { reason: 'begin_fallback' });
        break;
      case 'FALLBACK_APPROVING':
        await this.fallbackApprove(job, request, ctx);
        break;
      default:
        this.log.warn(ctx, 'no handler for state');
    }
  }

  private seasonsOf(request: RequestRow): number[] {
    try {
      return JSON.parse(request.seasonsJson ?? '[]') as number[];
    } catch {
      return [];
    }
  }

  private async validate(job: JobRow, request: RequestRow): Promise<void> {
    if (!['movie', 'tv'].includes(request.mediaType)) {
      this.repo.transitionJob(job.id, 'FAILED_PERMANENT', {
        reason: 'unsupported_media_type',
        patch: { errorClass: 'permanent', errorMessage: `Unsupported ${request.mediaType}` },
      });
      return;
    }

    // Enrich seasons / is4k from Seerr if webhook omitted them
    if (request.mediaType === 'tv' && this.seasonsOf(request).length === 0) {
      const seerrReq = await this.seerr.getRequest(request.seerrRequestId);
      const seasons = (seerrReq.seasons ?? []).map((s) => s.seasonNumber).filter((n) => n > 0);
      if (!seasons.length) {
        this.repo.transitionJob(job.id, 'FAILED_PERMANENT', {
          reason: 'no_seasons',
          patch: { errorClass: 'permanent', errorMessage: 'TV request has no seasons' },
        });
        return;
      }
      this.repo.updateRequestSeasons(request.id, seasons, !!seerrReq.is4k);
    }

    this.repo.transitionJob(job.id, 'CHECKING_JELLYFIN', { reason: 'validated' });
  }

  private async checkJellyfin(
    job: JobRow,
    request: RequestRow,
    ctx: Record<string, unknown>,
  ): Promise<void> {
    const seasons = this.seasonsOf(request);
    let present = false;
    if (request.mediaType === 'movie') {
      present = await this.jellyfin.movieExists(request.tmdbId);
    } else {
      const result = await this.jellyfin.tvSeasonsPresent(request.tmdbId, seasons);
      present = result.present;
      this.log.info(
        { ...ctx, missing: result.missing, episodeGaps: result.episodeGaps },
        'jellyfin tv check',
      );
    }

    if (present) {
      this.metrics?.xtreamMisses.inc({ reason: 'already_in_jellyfin' });
      const graceUntil = new Date(
        Date.now() + this.config.SEERR_AVAILABILITY_GRACE_SECONDS * 1000,
      ).toISOString();
      this.repo.transitionJob(job.id, 'WAITING_FOR_JELLYFIN', {
        reason: 'jellyfin_short_circuit',
        patch: {
          jellyfinVerifiedAt: new Date().toISOString(),
          availabilityGraceUntil: graceUntil,
        },
      });
      return;
    }

    this.repo.transitionJob(job.id, 'CHECKING_SEERR_OWNERSHIP', { reason: 'not_in_jellyfin' });
  }

  private isExternallyOwned(seerrReq: SeerrRequest): boolean {
    if (seerrReq.status === SEERR_APPROVED || seerrReq.status === SEERR_COMPLETED) return true;
    const mediaStatus = seerrReq.is4k ? seerrReq.media.status4k : seerrReq.media.status;
    if (mediaStatus === MEDIA_PROCESSING) return true;
    return false;
  }

  private async checkOwnership(
    job: JobRow,
    request: RequestRow,
    ctx: Record<string, unknown>,
  ): Promise<void> {
    const seerrReq = await this.seerr.getRequest(request.seerrRequestId);
    if (this.isExternallyOwned(seerrReq)) {
      this.log.info(ctx, 'request externally owned');
      this.repo.transitionJob(job.id, 'EXTERNALLY_HANDLED', {
        reason: 'seerr_already_owned',
        meta: { status: seerrReq.status, mediaStatus: seerrReq.media.status },
      });
      return;
    }
    this.repo.transitionJob(job.id, 'RESOLVING_QUALITY_PROFILE', { reason: 'unowned_pending' });
  }

  private async resolveQuality(
    job: JobRow,
    request: RequestRow,
    ctx: Record<string, unknown>,
  ): Promise<void> {
    const seerrReq = await this.seerr.getRequest(request.seerrRequestId);
    const profile = await this.qualityResolver.resolve(seerrReq);
    this.log.info(
      { ...ctx, profile: profile.name, serverId: profile.serverId, profileId: profile.profileId },
      'resolved quality profile',
    );
    this.repo.transitionJob(job.id, 'SEARCHING_XTREAM', {
      reason: 'quality_resolved',
      patch: {
        arrServerId: profile.serverId,
        arrProfileId: profile.profileId,
        arrProfileName: profile.name,
        arrType: profile.source,
        qualityResolutionSnapshot: JSON.stringify(profile.rawSnapshot),
      },
    });
  }

  private async searchXtream(
    job: JobRow,
    request: RequestRow,
    ctx: Record<string, unknown>,
  ): Promise<void> {
    this.repo.transitionJob(job.id, 'SEARCHING_XTREAM', { reason: 'search' });
    const seerrReq = await this.seerr.getRequest(request.seerrRequestId);
    const profile = await this.qualityResolver.resolve(seerrReq);

    const contentType = request.mediaType === 'tv' ? 'series' : 'vod';
    const candidates = await this.xtream.browseByTmdb(request.tmdbId, contentType);
    const match = matchMedia({
      tmdbId: request.tmdbId,
      title: seerrReq.media ? undefined : undefined,
      contentType,
      preferredSourceId: this.config.XTREAMFILTER_SOURCE_ID || undefined,
      preferredSourceName: this.config.XTREAMFILTER_SOURCE_NAME || undefined,
      candidates,
    });

    this.log.info(
      {
        ...ctx,
        matchKind: match.kind,
        candidateCount: match.candidates.length,
        reasons: match.reasons,
      },
      'identity match',
    );

    if (match.kind === 'AMBIGUOUS') {
      this.metrics?.xtreamMisses.inc({ reason: 'ambiguous' });
      this.repo.transitionJob(job.id, 'XTREAM_AMBIGUOUS', {
        reason: 'ambiguous_identity',
        meta: { reasons: match.reasons, candidates: match.candidates.map((c) => c.name) },
        patch: { matchKind: match.kind },
      });
      return;
    }
    if (match.kind === 'NOT_FOUND' || !match.candidates.length) {
      this.metrics?.xtreamMisses.inc({ reason: 'not_found' });
      this.repo.transitionJob(job.id, 'XTREAM_NOT_FOUND', {
        reason: 'not_found',
        patch: { matchKind: match.kind },
      });
      return;
    }

    if (request.mediaType === 'tv') {
      const ok = await this.tvScopeComplete(match.candidates, this.seasonsOf(request), ctx);
      if (!ok) {
        this.metrics?.xtreamMisses.inc({ reason: 'partial_season' });
        this.repo.transitionJob(job.id, 'FALLBACK_PENDING', {
          reason: 'tv_all_or_nothing',
          patch: { matchKind: match.kind },
        });
        return;
      }
    }

    this.repo.transitionJob(job.id, 'EVALUATING_XTREAM_CANDIDATES', {
      reason: 'identity_ok',
      patch: {
        matchKind: match.kind,
        arrProfileName: profile.name,
        qualityResolutionSnapshot: JSON.stringify(profile.rawSnapshot),
      },
    });

    const best =
      request.mediaType === 'movie'
        ? await this.selectProbedVodCandidate(job, request, match.candidates, profile, ctx)
        : this.selectCatalogueCandidate(match.candidates, profile, ctx);

    if (!best) {
      this.metrics?.xtreamMisses.inc({ reason: 'quality_incompatible' });
      this.repo.transitionJob(job.id, 'FALLBACK_PENDING', {
        reason: 'quality_incompatible',
      });
      return;
    }

    const decision: QualityDecision = {
      profile: {
        source: profile.source,
        serverId: profile.serverId,
        profileId: profile.profileId,
        name: profile.name,
      },
      candidateName: best.candidate.name,
      evaluation: best.evaluation,
      policy: this.config.QUALITY_UNKNOWN_POLICY,
      selectedAt: new Date().toISOString(),
    };

    this.log.info(
      {
        ...ctx,
        profile: profile.name,
        candidateId: best.candidate.streamId ?? best.candidate.seriesId,
        candidateName: best.candidate.name,
        sourceId: best.candidate.sourceId,
        sourceName: best.candidate.sourceName,
        compatible: true,
        width: best.evaluation.observed.width,
        height: best.evaluation.observed.height,
        resolution: best.evaluation.observed.resolution,
        codec: best.evaluation.observed.codec,
        bitrate: best.evaluation.observed.bitrate,
        audioLanguages: best.evaluation.observed.audioLanguages,
        rejectionReasons: [],
        reasons: best.evaluation.reasons,
        selectionWhy: best.why,
      },
      'selected xtream candidate',
    );

    this.metrics?.xtreamMatches.inc();
    this.repo.transitionJob(job.id, 'XTREAM_MATCHED', {
      reason: 'candidate_selected',
      meta: { candidate: best.candidate, decision },
      patch: {
        qualityDecision: JSON.stringify(decision),
        arrServerId: profile.serverId,
        arrProfileId: profile.profileId,
        arrProfileName: profile.name,
        arrType: profile.source,
      },
    });

    // stash selected candidate on xtream_items pending queue
    this.repo.upsertXtreamItem({
      jobId: job.id,
      sourceId: best.candidate.sourceId,
      streamId: best.candidate.streamId,
      seriesId: best.candidate.seriesId,
      name: best.candidate.name,
      status: 'selected',
      seasonNumber: request.mediaType === 'tv' ? (this.seasonsOf(request)[0] ?? null) : null,
    });
  }

  private selectCatalogueCandidate(
    candidates: MatchCandidate[],
    profile: Awaited<ReturnType<QualityProfileResolverService['resolve']>>,
    ctx: Record<string, unknown>,
  ): { candidate: MatchCandidate; evaluation: QualityEvaluation; why: string } | undefined {
    const evaluated = candidates.map((c) => {
      const observed = parseXtreamQuality({
        name: c.name,
        group: c.group,
        containerExtension: c.containerExtension,
      });
      const evaluation = evaluateCandidateQuality({
        profile,
        observed,
        policy: this.config.QUALITY_UNKNOWN_POLICY,
        preferredLanguages: this.config.XTREAM_PREFERRED_LANGUAGES,
      });
      return {
        candidate: c,
        evaluation,
        tieKey: `${c.sourceId}:${c.streamId ?? c.seriesId ?? c.name}`,
      };
    });
    const best = pickBestCompatible(evaluated);
    if (!best) {
      this.log.info(
        {
          ...ctx,
          profile: profile.name,
          evaluations: evaluated.map((e) => ({
            candidate: e.candidate.name,
            compatible: e.evaluation.compatible,
            reasons: e.evaluation.reasons,
          })),
        },
        'no quality-compatible series candidate',
      );
      return undefined;
    }
    return {
      candidate: best.candidate,
      evaluation: best.evaluation,
      why: `catalogue evaluation score=${best.evaluation.score}`,
    };
  }

  private async selectProbedVodCandidate(
    job: JobRow,
    request: RequestRow,
    candidates: MatchCandidate[],
    profile: Awaited<ReturnType<QualityProfileResolverService['resolve']>>,
    ctx: Record<string, unknown>,
  ): Promise<
    { candidate: MatchCandidate; evaluation: QualityEvaluation; why: string } | undefined
  > {
    const preferredLanguages = this.config.XTREAM_PREFERRED_LANGUAGES;
    const shortlist = buildProbeShortlist({
      candidates,
      preferredLanguages,
      profile,
      maxProbes: this.config.XTREAM_MAX_CANDIDATE_PROBES,
    });

    this.log.info(
      {
        ...ctx,
        profile: profile.name,
        profileId: profile.profileId,
        candidateCount: candidates.length,
        shortlist: shortlist.map((s) => ({
          id: s.candidate.streamId,
          name: s.candidate.name,
          languageScore: s.languageScore,
          catalogueLanguage: s.catalogueLanguage,
        })),
        maxProbes: this.config.XTREAM_MAX_CANDIDATE_PROBES,
      },
      'xtream probe shortlist',
    );

    type ProbedEval = {
      candidate: MatchCandidate;
      evaluation: QualityEvaluation;
      tieKey: string;
    };
    const probedCompatible: ProbedEval[] = [];
    let probesUsed = 0;

    for (const entry of shortlist) {
      const c = entry.candidate;
      if (!c.streamId) continue;

      const sourceRoute = await this.xtream.resolveSourceRoute(c.sourceId);
      if (!sourceRoute) {
        this.log.warn(
          {
            ...ctx,
            candidateId: c.streamId,
            candidateName: c.name,
            sourceId: c.sourceId,
            probeResult: 'no_source_route',
          },
          'skip candidate: XtreamFilter source has no route',
        );
        continue;
      }

      probesUsed += 1;
      const { urlRedacted, outcome } = await this.mediaProbe.probeVodCandidate({
        sourceRoute,
        streamId: c.streamId,
        containerExtension: c.containerExtension,
      });

      if (!outcome.ok) {
        this.log.info(
          {
            ...ctx,
            requestId: request.seerrRequestId,
            jobId: job.id,
            tmdbId: request.tmdbId,
            candidateId: c.streamId,
            candidateName: c.name,
            sourceId: c.sourceId,
            sourceName: c.sourceName,
            probeResult: outcome.reason,
            probeUrl: urlRedacted,
            rejectionReasons: [outcome.reason],
          },
          'xtream candidate probe failed',
        );
        continue;
      }

      const catalogue = parseXtreamQuality({
        name: c.name,
        group: c.group,
        containerExtension: c.containerExtension,
      });
      const observed = mergeProbeIntoQuality(catalogue, outcome);
      const evaluation = evaluateCandidateQuality({
        profile,
        observed,
        policy: this.config.QUALITY_UNKNOWN_POLICY,
        requireProbeEvidence: true,
        preferredLanguages,
      });

      this.log.info(
        {
          ...ctx,
          requestId: request.seerrRequestId,
          jobId: job.id,
          tmdbId: request.tmdbId,
          candidateId: c.streamId,
          candidateName: c.name,
          sourceId: c.sourceId,
          sourceName: c.sourceName,
          probeResult: 'ok',
          width: outcome.video?.width,
          height: outcome.video?.height,
          resolution: outcome.resolution,
          codec: outcome.video?.codec,
          bitrate: outcome.formatBitrate ?? outcome.video?.bitrate,
          audioLanguages: outcome.audioTracks.map((a) => a.language).filter(Boolean),
          compatible: evaluation.compatible,
          rejectionReasons: evaluation.compatible ? [] : evaluation.reasons,
          reasons: evaluation.reasons,
        },
        'xtream candidate probed',
      );

      if (!evaluation.compatible) continue;

      probedCompatible.push({
        candidate: c,
        evaluation,
        tieKey: `${c.sourceId}:${c.streamId}`,
      });

      if (
        shouldStopProbing({
          preferredLanguages,
          selectedLanguageScore: evaluation.languageScore ?? entry.languageScore,
          compatible: true,
        })
      ) {
        this.log.info(
          { ...ctx, candidateId: c.streamId, probesUsed },
          'stopping probe shortlist early (preferred language + compatible)',
        );
        break;
      }
    }

    const best = pickBestCompatible(probedCompatible);
    if (!best) {
      this.log.info(
        {
          ...ctx,
          profile: profile.name,
          probesUsed,
          shortlistSize: shortlist.length,
        },
        'no safely validated xtream candidate after probing',
      );
      return undefined;
    }

    return {
      candidate: best.candidate,
      evaluation: best.evaluation,
      why: `probed+compatible score=${best.evaluation.score}; probesUsed=${probesUsed}; ${best.evaluation.reasons.slice(0, 4).join('; ')}`,
    };
  }

  private async tvScopeComplete(
    candidates: MatchCandidate[],
    seasons: number[],
    ctx: Record<string, unknown>,
  ): Promise<boolean> {
    if (this.config.XTREAM_PARTIAL_POLICY !== 'all_or_nothing') {
      // v1 only implements all_or_nothing
    }
    const series = candidates.find((c) => c.contentType === 'series' && c.seriesId);
    if (!series?.seriesId) return false;

    const eps = await this.xtream.getSeriesEpisodes(series.sourceId, series.seriesId);
    const seasonsMap = eps.seasons ?? {};
    for (const season of seasons) {
      const list = seasonsMap[String(season)] ?? [];
      if (!list.length) {
        this.log.info({ ...ctx, season }, 'season missing on xtream');
        return false;
      }
      // Require contiguous episode numbers starting at 1 without gaps in provider list length heuristic:
      // If provider has episodes, treat season as complete for all_or_nothing when count >= 1 and
      // no explicit expected count from Seerr (season-level). Prefer presence of episode 1+.
      const nums = list
        .map((e) => Number(e.episode_num))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!nums.length) return false;
      const max = Math.max(...nums);
      for (let i = 1; i <= max; i++) {
        if (!nums.includes(i)) {
          this.log.info({ ...ctx, season, missingEpisode: i }, 'episode gap on xtream');
          return false;
        }
      }
    }
    return true;
  }

  private async queueXtream(
    job: JobRow,
    request: RequestRow,
    ctx: Record<string, unknown>,
  ): Promise<void> {
    this.repo.transitionJob(job.id, 'XTREAM_QUEUING', { reason: 'queue_start' });

    const items = this.repo.listXtreamItems(job.id);
    const selected =
      items.find((i) => i.status === 'selected' || i.status === 'queued') ?? items[0];
    if (!selected) {
      this.repo.transitionJob(job.id, 'FALLBACK_PENDING', { reason: 'no_selected_candidate' });
      return;
    }

    const can = await this.providerActivity.canAcquire({
      id: selected.sourceId,
      name: selected.name ?? undefined,
    });
    if (!can) {
      this.repo.transitionJob(job.id, 'FAILED_RETRYABLE', {
        reason: 'provider_busy',
        patch: { errorClass: 'retryable', errorMessage: 'ProviderActivityService denied acquire' },
      });
      return;
    }

    const seerrReq = await this.seerr.getRequest(request.seerrRequestId);
    if (this.isExternallyOwned(seerrReq) || seerrReq.status !== SEERR_PENDING) {
      this.repo.transitionJob(job.id, 'EXTERNALLY_HANDLED', {
        reason: 'owned_before_queue',
        meta: { status: seerrReq.status },
      });
      return;
    }

    // optional profile revalidation
    if (
      job.arrProfileId != null &&
      seerrReq.profileId != null &&
      seerrReq.profileId !== job.arrProfileId
    ) {
      this.log.warn(ctx, 'profile changed before queue; re-resolving via fallback path');
      this.repo.transitionJob(job.id, 'RESOLVING_QUALITY_PROFILE', { reason: 'profile_changed' });
      return;
    }

    if (request.mediaType === 'movie') {
      await this.queueMovie(
        job,
        selected.sourceId,
        String(selected.streamId),
        selected.name ?? 'movie',
      );
    } else {
      await this.queueTvSeasons(
        job,
        request,
        selected.sourceId,
        String(selected.seriesId),
        selected.name ?? 'series',
      );
    }
  }

  private async queueMovie(job: JobRow, sourceId: string, streamId: string, name: string) {
    const opKey = `queue:seerr:${this.repo.getRequest(job.requestId)!.seerrRequestId}:movie:${job.tmdbId}`;
    const existing = this.repo.getOperation(opKey);
    if (existing?.status === 'succeeded') {
      this.repo.transitionJob(job.id, 'XTREAM_QUEUED', { reason: 'queue_already_succeeded' });
      return;
    }

    this.repo.beginOperation(opKey, job.id, { sourceId, streamId, name });
    const cartBefore = await this.xtream.listCart();
    const already = this.xtream.findCartMovie(cartBefore, sourceId, streamId);
    if (already) {
      this.repo.completeOperation(opKey, 'succeeded', { adopted: true, cart: already });
      this.repo.updateXtreamItemStatus(this.repo.listXtreamItems(job.id)[0]?.id ?? 0, 'queued');
      this.metrics?.downloadsQueued.inc();
      await this.xtream.startCart().catch(() => undefined);
      this.repo.transitionJob(job.id, 'XTREAM_QUEUED', { reason: 'already_in_cart' });
      return;
    }

    const res = await this.xtream.addToCart({
      source_id: sourceId,
      stream_id: streamId,
      content_type: 'vod',
      name,
    });

    if (res.status === 409) {
      const cart = await this.xtream.listCart();
      const found = this.xtream.findCartMovie(cart, sourceId, streamId);
      if (!found) {
        this.repo.completeOperation(opKey, 'failed', { status: 409, verified: false });
        throw new BridgeError('Cart 409 but movie tuple not present', {
          errorClass: 'retryable',
          statusCode: 409,
        });
      }
      this.repo.completeOperation(opKey, 'succeeded', { status: 409, verified: true, cart: found });
    } else {
      this.repo.completeOperation(opKey, 'succeeded', { status: res.status, data: res.data });
    }

    this.metrics?.downloadsQueued.inc();
    await this.xtream.startCart().catch(() => undefined);
    this.repo.transitionJob(job.id, 'XTREAM_QUEUED', { reason: 'queued_movie' });
  }

  private async queueTvSeasons(
    job: JobRow,
    request: RequestRow,
    sourceId: string,
    seriesId: string,
    name: string,
  ) {
    const seasons = this.seasonsOf(request);
    const seerrId = request.seerrRequestId;

    for (const season of seasons) {
      const opKey = `queue:seerr:${seerrId}:tv:${job.tmdbId}:season:${season}`;
      const existing = this.repo.getOperation(opKey);
      if (existing?.status === 'succeeded') continue;

      this.repo.beginOperation(opKey, job.id, { sourceId, seriesId, season, name });
      const cartBefore = await this.xtream.listCart();
      const existingItems = this.xtream.findCartSeason(cartBefore, sourceId, seriesId, season);
      if (existingItems.length) {
        this.repo.completeOperation(opKey, 'succeeded', {
          adopted: true,
          count: existingItems.length,
        });
        continue;
      }

      const res = await this.xtream.addToCart({
        content_type: 'series',
        add_mode: 'season',
        source_id: sourceId,
        series_id: seriesId,
        stream_id: seriesId,
        series_name: name,
        name,
        season_num: String(season),
      });

      if (res.status === 409) {
        const cart = await this.xtream.listCart();
        const found = this.xtream.findCartSeason(cart, sourceId, seriesId, season);
        if (!found.length) {
          this.repo.completeOperation(opKey, 'failed', { status: 409, verified: false });
          throw new BridgeError(`Cart 409 but season ${season} tuple not present`, {
            errorClass: 'retryable',
            statusCode: 409,
          });
        }
        this.repo.completeOperation(opKey, 'succeeded', { status: 409, verified: true });
      } else {
        this.repo.completeOperation(opKey, 'succeeded', { status: res.status, data: res.data });
      }
      this.metrics?.downloadsQueued.inc();
    }

    await this.xtream.startCart().catch(() => undefined);
    this.repo.transitionJob(job.id, 'XTREAM_QUEUED', {
      reason: 'queued_seasons',
      meta: { seasons },
    });
  }

  private async pollXtream(job: JobRow, ctx: Record<string, unknown>): Promise<void> {
    this.repo.transitionJob(job.id, 'XTREAM_DOWNLOADING', { reason: 'poll' });
    const selected = this.repo.listXtreamItems(job.id)[0];
    if (!selected) {
      this.repo.transitionJob(job.id, 'FALLBACK_PENDING', { reason: 'missing_xtream_item' });
      return;
    }

    const cart = await this.xtream.listCart();
    let relevant;
    if (selected.streamId) {
      relevant = cart.filter(
        (i) =>
          i.source_id === selected.sourceId && String(i.stream_id) === String(selected.streamId),
      );
    } else {
      relevant = cart.filter(
        (i) =>
          i.source_id === selected.sourceId && String(i.series_id) === String(selected.seriesId),
      );
    }

    if (!relevant.length) {
      // May have completed and been cleared — proceed to jellyfin wait cautiously via history absence
      this.log.info(ctx, 'cart items absent; assuming completed or cleared');
      const graceUntil = new Date(
        Date.now() + this.config.SEERR_AVAILABILITY_GRACE_SECONDS * 1000,
      ).toISOString();
      this.repo.transitionJob(job.id, 'WAITING_FOR_JELLYFIN', {
        reason: 'cart_empty_assume_done',
        patch: { availabilityGraceUntil: graceUntil },
      });
      return;
    }

    const statuses = relevant.map((i) => i.status ?? '');
    if (statuses.some((s) => s === 'failed')) {
      throw new BridgeError('XtreamFilter download failed', { errorClass: 'retryable' });
    }
    if (statuses.every((s) => s === 'completed' || s === 'cancelled')) {
      const graceUntil = new Date(
        Date.now() + this.config.SEERR_AVAILABILITY_GRACE_SECONDS * 1000,
      ).toISOString();
      this.repo.transitionJob(job.id, 'WAITING_FOR_JELLYFIN', {
        reason: 'cart_completed',
        patch: { availabilityGraceUntil: graceUntil },
      });
      return;
    }
    // still downloading — leave in XTREAM_DOWNLOADING
    this.log.debug({ ...ctx, statuses }, 'xtream still downloading');
  }

  private async waitJellyfin(
    job: JobRow,
    request: RequestRow,
    ctx: Record<string, unknown>,
  ): Promise<void> {
    await this.jellyfin.refreshLibrary().catch((err) => {
      this.log.warn({ ...ctx, err: String(err) }, 'jellyfin refresh failed');
    });

    const seasons = this.seasonsOf(request);
    let present = false;
    if (request.mediaType === 'movie') {
      present = await this.jellyfin.movieExists(request.tmdbId);
    } else {
      present = (await this.jellyfin.tvSeasonsPresent(request.tmdbId, seasons)).present;
    }

    if (!present) {
      this.log.info(ctx, 'jellyfin not yet verified');
      return;
    }

    const verifiedAt = new Date().toISOString();
    let graceUntil = job.availabilityGraceUntil;
    if (!graceUntil) {
      graceUntil = new Date(
        Date.now() + this.config.SEERR_AVAILABILITY_GRACE_SECONDS * 1000,
      ).toISOString();
      this.repo.transitionJob(job.id, 'WAITING_FOR_JELLYFIN', {
        reason: 'jellyfin_verified',
        patch: { jellyfinVerifiedAt: verifiedAt, availabilityGraceUntil: graceUntil },
      });
    } else if (!job.jellyfinVerifiedAt) {
      this.repo.transitionJob(job.id, 'WAITING_FOR_JELLYFIN', {
        reason: 'jellyfin_verified',
        patch: { jellyfinVerifiedAt: verifiedAt },
      });
    }

    if (Date.parse(graceUntil) > Date.now()) {
      this.log.info({ ...ctx, graceUntil }, 'waiting seerr availability grace');
      return;
    }

    // Grace elapsed — check Seerr / mark available
    const seerrReq = await this.seerr.getRequest(request.seerrRequestId);
    const mediaStatus = seerrReq.is4k ? seerrReq.media.status4k : seerrReq.media.status;
    const seasonsAvailable =
      request.mediaType === 'movie'
        ? mediaStatus === MEDIA_AVAILABLE
        : seasons.every((s) => {
            const row = seerrReq.media.seasons?.find((ms) => ms.seasonNumber === s);
            return row?.status === MEDIA_AVAILABLE || mediaStatus === MEDIA_AVAILABLE;
          });

    if (!seasonsAvailable && mediaStatus !== MEDIA_AVAILABLE) {
      const opKey = `mark-available:seerr:${request.seerrRequestId}`;
      const op = this.repo.getOperation(opKey);
      if (op?.status !== 'succeeded') {
        this.repo.beginOperation(opKey, job.id, { mediaId: seerrReq.media.id });
        await this.seerr.markMediaAvailable(seerrReq.media.id, {
          is4k: !!seerrReq.is4k,
          ...(request.mediaType === 'tv'
            ? { seasons: seasons.map((seasonNumber) => ({ seasonNumber })) }
            : {}),
        });
        this.repo.completeOperation(opKey, 'succeeded', {});
      }
    }

    const completionGrace = new Date(
      Date.now() + this.config.SEERR_REQUEST_COMPLETION_GRACE_SECONDS * 1000,
    ).toISOString();

    this.repo.transitionJob(job.id, 'AVAILABLE', {
      reason: 'media_available_path',
      patch: { completionGraceUntil: completionGrace },
    });
  }

  private async completeSeerr(
    job: JobRow,
    request: RequestRow,
    ctx: Record<string, unknown>,
  ): Promise<void> {
    this.repo.transitionJob(job.id, 'COMPLETING_SEERR', { reason: 'completing' });
    const seerrReq = await this.seerr.getRequest(request.seerrRequestId);

    if (seerrReq.status === SEERR_COMPLETED) {
      this.metrics?.requests.inc({ result: 'completed' });
      this.repo.transitionJob(job.id, 'COMPLETED', { reason: 'seerr_completed' });
      return;
    }

    const mediaStatus = seerrReq.is4k ? seerrReq.media.status4k : seerrReq.media.status;
    if (mediaStatus !== MEDIA_AVAILABLE) {
      // bounce back to wait
      this.repo.transitionJob(job.id, 'WAITING_FOR_JELLYFIN', {
        reason: 'media_not_available_yet',
      });
      return;
    }

    // Prefer natural subscriber lifecycle
    if (seerrReq.status !== SEERR_PENDING) {
      // APPROVED etc — wait for COMPLETED
      if (job.completionGraceUntil && Date.parse(job.completionGraceUntil) > Date.now()) {
        this.log.info(ctx, 'waiting for seerr auto-complete');
        return;
      }
    }

    if (seerrReq.status === SEERR_PENDING) {
      const graceOk =
        !job.completionGraceUntil || Date.parse(job.completionGraceUntil) <= Date.now();
      if (!graceOk) {
        this.log.info(ctx, 'completion grace not elapsed; not approving yet');
        return;
      }

      // re-verify AVAILABLE then approve once
      const fresh = await this.seerr.getRequest(request.seerrRequestId);
      const freshStatus = fresh.is4k ? fresh.media.status4k : fresh.media.status;
      if (freshStatus !== MEDIA_AVAILABLE) {
        this.repo.transitionJob(job.id, 'WAITING_FOR_JELLYFIN', { reason: 'lost_availability' });
        return;
      }

      const opKey = `approve:seerr:${request.seerrRequestId}`;
      const op = this.repo.getOperation(opKey);
      if (op?.status !== 'succeeded') {
        this.repo.beginOperation(opKey, job.id, {});
        await this.seerr.approveRequest(request.seerrRequestId);
        this.repo.completeOperation(opKey, 'succeeded', { reconciliation: true });
        this.log.info(ctx, 'reconciliation approve after AVAILABLE');
      }
    }

    const after = await this.seerr.getRequest(request.seerrRequestId);
    if (after.status === SEERR_COMPLETED) {
      this.metrics?.requests.inc({ result: 'completed' });
      this.repo.transitionJob(job.id, 'COMPLETED', { reason: 'seerr_completed_after_approve' });
    }
  }

  private async fallbackApprove(
    job: JobRow,
    request: RequestRow,
    ctx: Record<string, unknown>,
  ): Promise<void> {
    const seerrReq = await this.seerr.getRequest(request.seerrRequestId);
    if (seerrReq.status !== SEERR_PENDING) {
      if (this.isExternallyOwned(seerrReq)) {
        this.repo.transitionJob(job.id, 'EXTERNALLY_HANDLED', { reason: 'fallback_already_owned' });
        return;
      }
      this.repo.transitionJob(job.id, 'HANDED_TO_ARR', { reason: 'already_non_pending' });
      return;
    }

    const opKey = `fallback:seerr:${request.seerrRequestId}`;
    const op = this.repo.getOperation(opKey);
    if (op?.status !== 'succeeded') {
      this.repo.beginOperation(opKey, job.id, {
        profileId: seerrReq.profileId,
        serverId: seerrReq.serverId,
      });
      // NEVER rewrite profile — approve original request as-is
      await this.seerr.approveRequest(request.seerrRequestId);
      this.repo.completeOperation(opKey, 'succeeded', {
        profileId: seerrReq.profileId,
        serverId: seerrReq.serverId,
      });
    }

    this.metrics?.fallbacks.inc();
    this.metrics?.requests.inc({ result: 'handed_to_arr' });
    this.log.info(
      { ...ctx, profileId: seerrReq.profileId, serverId: seerrReq.serverId },
      'handed to arr with original profile',
    );
    this.repo.transitionJob(job.id, 'HANDED_TO_ARR', {
      reason: 'fallback_approved',
      meta: { profileId: seerrReq.profileId, serverId: seerrReq.serverId },
    });
  }
}
