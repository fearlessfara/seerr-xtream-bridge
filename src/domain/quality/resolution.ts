import type { XtreamMediaQuality } from './types.js';

export type ClassifiedResolution = NonNullable<XtreamMediaQuality['resolution']>;

/**
 * Classify resolution primarily from height, with tolerance for cropped/cinema encodes.
 * Width is used as a secondary signal for near-boundary heights.
 */
export function classifyResolutionFromDims(
  width?: number,
  height?: number,
): ClassifiedResolution | undefined {
  if (height == null && width == null) return undefined;
  const h = height ?? 0;
  const w = width ?? 0;

  // UHD / 4K
  if (h >= 2000 || (h >= 1600 && w >= 3200) || w >= 3800) return 2160;
  // 1080p family (incl. 1920x800+ cinema crops, 1440x1080)
  if (h >= 900 || (h >= 800 && w >= 1700) || w >= 1800) return 1080;
  // 720p
  if (h >= 680 || (h >= 540 && w >= 1200) || w >= 1280) return 720;
  // SD
  if (h >= 500 || w >= 700) return 576;
  if (h > 0 || w > 0) return 480;
  return undefined;
}
