import { v4 as uuidv4 } from 'uuid';

export type TimeUnit = 'ns' | 'us' | 'ms' | 's';

export const UNIT_LABELS: Record<TimeUnit, string> = {
  ns: 'nanoseconds',
  us: 'microseconds',
  ms: 'milliseconds',
  s: 'seconds',
};

/** Multiplier that converts a value in the given unit to milliseconds. */
export const UNIT_TO_MS: Record<TimeUnit, number> = {
  ns: 1e-6,
  us: 1e-3,
  ms: 1,
  s: 1000,
};

const UNITS = Object.keys(UNIT_TO_MS) as TimeUnit[];

export type LoopSegment = {
  id: string;
  /** Telemetry key carrying this segment's duration. */
  key: string;
  label: string;
  /** Bar color as `#rrggbb`. */
  color: string;
};

export type LoopProfile = {
  id: string;
  name: string;
  unit: TimeUnit;
  /**
   * Telemetry key holding the whole loop's duration. When null the total is
   * taken as the sum of the segments.
   */
  totalKey: string | null;
  /** Loop time target in ms; drives the over-budget warning. 0 disables it. */
  budgetMs: number;
  segments: LoopSegment[];
};

export type LoopProfileStore = {
  profiles: LoopProfile[];
  activeId: string;
};

export const PROFILES_STORAGE_KEY = 'loopTimeProfiles';

/** Distinct hues that stay legible against both themes. */
export const SEGMENT_PALETTE = [
  '#3B82F6',
  '#F59E0B',
  '#10B981',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#6366F1',
  '#84CC16',
];

export function nextPaletteColor(used: number): string {
  return SEGMENT_PALETTE[used % SEGMENT_PALETTE.length];
}

/**
 * Turns a telemetry key into a readable label, e.g. `loop/vision` -> `vision`
 * and `loopDriveMs` -> `loopDriveMs`.
 */
export function labelFromKey(key: string): string {
  const tail = key.split(/[/.]/).pop() ?? key;
  const trimmed = tail.replace(/[_-]/g, ' ').trim();
  if (trimmed === '') return key;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function newSegment(key: string, usedCount: number): LoopSegment {
  return {
    id: uuidv4(),
    key,
    label: labelFromKey(key),
    color: nextPaletteColor(usedCount),
  };
}

export function newProfile(name: string): LoopProfile {
  return {
    id: uuidv4(),
    name,
    unit: 'ms',
    totalKey: null,
    budgetMs: 0,
    segments: [],
  };
}

export function defaultStore(): LoopProfileStore {
  const profile = newProfile('Default');
  return { profiles: [profile], activeId: profile.id };
}

function sanitizeSegment(raw: unknown): LoopSegment[] {
  if (typeof raw !== 'object' || raw === null) return [];

  const { id, key, label, color } = raw as Record<string, unknown>;
  if (typeof key !== 'string' || key === '') return [];

  return [
    {
      id: typeof id === 'string' && id !== '' ? id : uuidv4(),
      key,
      label: typeof label === 'string' && label !== '' ? label : key,
      color:
        typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
          ? color
          : SEGMENT_PALETTE[0],
    },
  ];
}

function sanitizeProfile(raw: unknown): LoopProfile[] {
  if (typeof raw !== 'object' || raw === null) return [];

  const { id, name, unit, totalKey, budgetMs, segments } = raw as Record<
    string,
    unknown
  >;

  return [
    {
      id: typeof id === 'string' && id !== '' ? id : uuidv4(),
      name: typeof name === 'string' && name !== '' ? name : 'Profile',
      unit: UNITS.includes(unit as TimeUnit) ? (unit as TimeUnit) : 'ms',
      totalKey:
        typeof totalKey === 'string' && totalKey !== '' ? totalKey : null,
      budgetMs:
        typeof budgetMs === 'number' &&
        Number.isFinite(budgetMs) &&
        budgetMs > 0
          ? budgetMs
          : 0,
      segments: Array.isArray(segments)
        ? segments.flatMap(sanitizeSegment)
        : [],
    },
  ];
}

/**
 * Re-validates the stored profiles. Runs against whatever JSON is in
 * localStorage, including imports pasted in by the user, so it must never
 * assume a shape.
 */
export function sanitizeStore(raw: unknown): LoopProfileStore {
  if (typeof raw !== 'object' || raw === null) return defaultStore();

  const { profiles, activeId } = raw as Record<string, unknown>;
  const parsed = Array.isArray(profiles)
    ? profiles.flatMap(sanitizeProfile)
    : [];

  if (parsed.length === 0) return defaultStore();

  const active =
    typeof activeId === 'string' && parsed.some((p) => p.id === activeId)
      ? activeId
      : parsed[0].id;

  return { profiles: parsed, activeId: active };
}
