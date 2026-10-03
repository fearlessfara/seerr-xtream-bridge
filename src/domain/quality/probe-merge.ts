import type { MediaProbeResult } from '../../services/xtream-media-probe.js';
import type { XtreamMediaQuality } from './types.js';

/** Merge ffprobe evidence into catalogue observations. Probe wins for resolution/codec. */
export function mergeProbeIntoQuality(
  catalogue: XtreamMediaQuality,
  probe: MediaProbeResult,
): XtreamMediaQuality {
  const audioLanguages = probe.audioTracks
    .map((a) => a.language)
    .filter((l): l is string => Boolean(l));

  return {
    ...catalogue,
    resolution: probe.resolution ?? catalogue.resolution,
    codec: probe.video?.codec ?? catalogue.codec,
    width: probe.video?.width,
    height: probe.video?.height,
    bitrate: probe.video?.bitrate ?? probe.formatBitrate ?? catalogue.bitrate,
    audioLanguages: audioLanguages.length ? audioLanguages : catalogue.audioLanguages,
    confidence: 'probed',
    probed: true,
    evidence: [
      ...catalogue.evidence,
      'probe:ffprobe',
      ...(probe.resolution ? [`probe_resolution:${probe.resolution}`] : []),
      ...(probe.video?.codec ? [`probe_codec:${probe.video.codec}`] : []),
      ...(probe.video?.width != null && probe.video?.height != null
        ? [`probe_dims:${probe.video.width}x${probe.video.height}`]
        : []),
      ...audioLanguages.map((l) => `probe_audio_lang:${l}`),
    ],
  };
}
