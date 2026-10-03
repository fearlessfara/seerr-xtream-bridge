import { parseCatalogueLanguageHints } from './language.js';
import type { QualityConfidence, XtreamMediaQuality } from './types.js';

const RES_PATTERNS: Array<{
  re: RegExp;
  resolution: NonNullable<XtreamMediaQuality['resolution']>;
}> = [
  { re: /(?:^|[\s\-_.])(2160p|4k|uhd)(?:$|[\s\-_.])/i, resolution: 2160 },
  { re: /(?:^|[\s\-_.])(1080p|fhd)(?:$|[\s\-_.])/i, resolution: 1080 },
  { re: /(?:^|[\s\-_.])(720p)(?:$|[\s\-_.])/i, resolution: 720 },
  { re: /(?:^|[\s\-_.])(576p|pal)(?:$|[\s\-_.])/i, resolution: 576 },
  { re: /(?:^|[\s\-_.])(480p|sd)(?:$|[\s\-_.])/i, resolution: 480 },
];

export function parseXtreamQuality(input: {
  name: string;
  group?: string;
  containerExtension?: string;
  extraText?: string;
}): XtreamMediaQuality {
  const text = [input.name, input.group, input.extraText, input.containerExtension]
    .filter(Boolean)
    .join(' ');
  const evidence: string[] = [];
  let confidence: QualityConfidence = 'unknown';

  const hints = parseCatalogueLanguageHints({ name: input.name, group: input.group });
  evidence.push(...hints.evidence);

  let resolution: XtreamMediaQuality['resolution'];
  for (const p of RES_PATTERNS) {
    if (p.re.test(text)) {
      resolution = p.resolution;
      evidence.push(`resolution:${p.resolution}`);
      confidence = 'high';
      break;
    }
  }

  const dolbyVision = /\b(dolby\s*vision|\bdv\b|dovi)\b/i.test(text);
  const hdr = dolbyVision || /\b(hdr10\+|hdr10|hdr)\b/i.test(text);
  if (hdr) {
    evidence.push(dolbyVision ? 'hdr:dv' : 'hdr:true');
    if (confidence === 'unknown') confidence = 'medium';
  }

  let codec: string | undefined;
  if (/\b(av1)\b/i.test(text)) codec = 'av1';
  else if (/\b(hevc|x265|h\.?265)\b/i.test(text)) codec = 'hevc';
  else if (/\b(avc|x264|h\.?264)\b/i.test(text)) codec = 'h264';
  if (codec) {
    evidence.push(`codec:${codec}`);
    if (confidence === 'unknown') confidence = 'medium';
  }

  let source: string | undefined;
  if (/\b(web-?dl|webdl)\b/i.test(text)) source = 'webdl';
  else if (/\b(webrip|web-?rip)\b/i.test(text)) source = 'webrip';
  else if (/\b(bluray|blu-ray|bdrip|brip)\b/i.test(text)) source = 'bluray';
  else if (/\b(hdtv)\b/i.test(text)) source = 'tv';
  if (source) {
    evidence.push(`source:${source}`);
    if (confidence === 'unknown' || confidence === 'medium') confidence = 'high';
  }

  if (!evidence.length) confidence = 'unknown';

  return {
    resolution,
    hdr: hdr || undefined,
    dolbyVision: dolbyVision || undefined,
    codec,
    source,
    language: hints.language,
    platform: hints.platform,
    confidence,
    evidence,
    probed: false,
  };
}
