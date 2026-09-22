import { LoopProfile, LoopSegment, UNIT_TO_MS } from './profiles';
import { LoopSample } from './useLoopSamples';

export type SegmentStats = {
  segment: LoopSegment;
  /** Milliseconds in the most recent sample, or null if the key was absent. */
  last: number | null;
  mean: number | null;
  max: number | null;
  /** Fraction of the most recent loop total, 0-1. */
  share: number;
};

export type LoopStats = {
  /** Per-sample loop totals in ms, oldest first. */
  totals: number[];
  lastTotal: number | null;
  meanTotal: number | null;
  maxTotal: number | null;
  p95Total: number | null;
  /** Loop rate derived from the mean total, or null if it can't be derived. */
  hz: number | null;
  segments: SegmentStats[];
  /** Loop time in the last sample not covered by any segment, in ms. */
  unaccounted: number;
  /** True when a total key is configured, so unaccounted time is meaningful. */
  hasExplicitTotal: boolean;
  sampleCount: number;
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function max(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => Math.max(a, b), -Infinity);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Reduces the sample window into the numbers the view renders. All outputs are
 * in milliseconds regardless of the unit the robot reports.
 */
export default function computeStats(
  samples: LoopSample[],
  profile: LoopProfile,
): LoopStats {
  const scale = UNIT_TO_MS[profile.unit];
  const { segments, totalKey } = profile;

  const segmentSeries = segments.map(() => [] as number[]);
  const totals: number[] = [];

  for (const sample of samples) {
    let segmentSum = 0;
    let sawSegment = false;

    segments.forEach((segment, i) => {
      const raw = sample.values[segment.key];
      if (raw === undefined) return;

      const ms = raw * scale;
      segmentSeries[i].push(ms);
      segmentSum += ms;
      sawSegment = true;
    });

    if (totalKey !== null) {
      const raw = sample.values[totalKey];
      if (raw !== undefined) totals.push(raw * scale);
    } else if (sawSegment) {
      totals.push(segmentSum);
    }
  }

  const lastSample = samples[samples.length - 1];
  const lastTotal = totals.length === 0 ? null : totals[totals.length - 1];

  const segmentStats: SegmentStats[] = segments.map((segment, i) => {
    const series = segmentSeries[i];
    const lastRaw = lastSample?.values[segment.key];
    const last = lastRaw === undefined ? null : lastRaw * scale;

    return {
      segment,
      last,
      mean: mean(series),
      max: max(series),
      share:
        last === null || lastTotal === null || lastTotal <= 0
          ? 0
          : last / lastTotal,
    };
  });

  const accountedLast = segmentStats.reduce(
    (acc, stat) => acc + (stat.last ?? 0),
    0,
  );
  const meanTotal = mean(totals);

  return {
    totals,
    lastTotal,
    meanTotal,
    maxTotal: max(totals),
    p95Total: percentile(totals, 95),
    hz: meanTotal !== null && meanTotal > 0 ? 1000 / meanTotal : null,
    segments: segmentStats,
    unaccounted:
      lastTotal === null ? 0 : Math.max(0, lastTotal - accountedLast),
    hasExplicitTotal: totalKey !== null,
    sampleCount: samples.length,
  };
}

export function formatMs(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}
