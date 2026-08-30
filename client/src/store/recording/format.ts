import type { DrawOp, TelemetryItem } from '@/store/types/telemetry';
import type { RobotStatus } from '@/store/types/status';

export const RECORDING_VERSION = 2;

/** Keyframe spacing. Bounds a seek to at most this many forward folds. */
const KEYFRAME_INTERVAL = 50;

/** Frame flag: this frame is the server's zero-length batch. */
export const FLAG_CLEAR = 1;

/** Anything else reaches Field.js's `default` branch and throws from inside the
 *  playback loop, so imported recordings are filtered against this. */
const KNOWN_OP_TYPES = new Set([
  'scale',
  'rotation',
  'translate',
  'fill',
  'stroke',
  'strokeWidth',
  'circle',
  'polygon',
  'polyline',
  'spline',
  'image',
  'text',
  'grid',
  'alpha',
]);

export type MarkerKind = 'log' | 'error' | 'opmode';

export type Marker = {
  t: number;
  kind: MarkerKind;
  text: string;
};

export type StatusSample = [number, Partial<RobotStatus>];

export type RecordingMeta = {
  id: string;
  name: string;
  opMode: string;
  createdAt: number;
  /** First recorded packet's own timestamp, kept so exports can be re-aligned. */
  robotT0: number;
  durationMs: number;
  frameCount: number;
  bytes: number;
  channels: {
    telemetry: boolean;
    field: boolean;
  };
  origin: 'recorded' | 'imported';
  /** Auto-captures are evicted oldest first; renaming, exporting or keeping one
   *  pins it, and pinned recordings are never evicted. */
  pinned: boolean;
};

/**
 * One recorded packet. `dataDelta` merges, `log` replaces, and a null ref means
 * unchanged from the previous frame.
 */
export type Frame = [
  t: number,
  dataDelta: Record<string, string> | null,
  log: string[] | null,
  overlayRef: number | null,
  fieldRef: number | null,
  flags?: number,
  extraRef?: number | null,
];

export type Keyframe = {
  /** Index of the frame this snapshot reflects, inclusive. */
  f: number;
  t: number;
  data: Record<string, string>;
  log: string[];
  o: number;
  fd: number;
  x: number;
};

export type Recording = {
  v: typeof RECORDING_VERSION;
  id: string;
  meta: RecordingMeta;
  /** Telemetry key dictionary. Frame deltas index into this. */
  keys: string[];
  /** Interned draw-op arrays. Index 0 is always empty. */
  dict: DrawOp[][];
  /** Interned unknown packet fields, so a future dashboard's data survives a
   *  round trip here. Index 0 is always empty. */
  xdict: Record<string, unknown>[];
  frames: Frame[];
  index: Keyframe[];
  status: StatusSample[];
  markers: Marker[];
};

export type FoldedState = {
  data: Record<string, string>;
  log: string[];
  /** Whether the frame just applied carried `log`. The track has replace
   *  semantics, so replaying it verbatim re-emits lines on every packet. */
  logFresh: boolean;
  o: number;
  fd: number;
  x: number;
  /** Index of the last frame applied, or -1 if none. */
  frameIdx: number;
};

const PACKET_KNOWN_FIELDS = new Set([
  'data',
  'log',
  'field',
  'fieldOverlay',
  'timestamp',
]);

function frameFlags(f: Frame): number {
  return f[5] ?? 0;
}

function frameExtraRef(f: Frame): number | null {
  return f[6] ?? null;
}

/** Stable-enough key for interning. Op arrays come off the wire in field order. */
function internKey(value: unknown): string {
  return JSON.stringify(value);
}

class Interner<T> {
  readonly values: T[] = [];
  /** A moving robot interns a distinct overlay every frame, so the dictionary
   *  is most of the recording; frame tuples alone understate it threefold. */
  bytes = 0;
  private readonly byKey = new Map<string, number>();

  constructor(empty: T) {
    this.values.push(empty);
    this.byKey.set(internKey(empty), 0);
  }

  intern(value: T): number {
    const key = internKey(value);
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;

    const idx = this.values.length;
    this.values.push(value);
    this.byKey.set(key, idx);
    this.bytes += key.length;
    return idx;
  }
}

export type EncoderStats = {
  frames: number;
  bytes: number;
  durationMs: number;
};

export type Encoder = {
  addBatch(packets: TelemetryItem[], wallElapsedMs: number): void;
  addStatus(status: Partial<RobotStatus>, wallElapsedMs: number): void;
  addMarker(marker: Marker): void;
  stats(): EncoderStats;
  /** Builds the full record. Cheap enough to call on every flush. */
  snapshot(
    meta: Omit<RecordingMeta, 'durationMs' | 'frameCount' | 'bytes'>,
  ): Recording;
};

export function createEncoder(): Encoder {
  const keys: string[] = [];
  const keyIndex = new Map<string, number>();
  const ops = new Interner<DrawOp[]>([]);
  const extras = new Interner<Record<string, unknown>>({});

  const frames: Frame[] = [];
  const index: Keyframe[] = [];
  const status: StatusSample[] = [];
  const markers: Marker[] = [];

  // Running fold, so keyframes and deltas can be computed in one pass.
  let data: Record<string, string> = {};
  let log: string[] = [];
  let overlayRef = 0;
  let fieldRef = 0;
  let extraRef = 0;

  let robotT0 = Number.NaN;
  /** Browser-elapsed time at which robotT0 was captured, so both clocks share an origin. */
  let robotWallBase = 0;
  let lastT = 0;
  let bytes = 0;

  function keyIdx(key: string): number {
    const existing = keyIndex.get(key);
    if (existing !== undefined) return existing;

    const idx = keys.length;
    keys.push(key);
    keyIndex.set(key, idx);
    return idx;
  }

  function pushKeyframeIfDue() {
    if (frames.length % KEYFRAME_INTERVAL !== 0) return;

    index.push({
      f: frames.length - 1,
      t: lastT,
      data: { ...data },
      log: [...log],
      o: overlayRef,
      fd: fieldRef,
      x: extraRef,
    });
  }

  function pushFrame(f: Frame) {
    frames.push(f);
    // Rough running size. Exact enough to drive a warning threshold, and far
    // cheaper than stringifying the whole recording once a second.
    bytes += internKey(f).length;
    pushKeyframeIfDue();
  }

  /** Frame tuples plus both intern dictionaries, which dominate for a moving robot. */
  function totalBytes(): number {
    return bytes + ops.bytes + extras.bytes;
  }

  /** All three tracks: an op mode pushing no telemetry still has status and
   *  marker history, and duration 0 collapses the transport bar. */
  function duration(): number {
    let end = lastT;
    if (status.length > 0) end = Math.max(end, status[status.length - 1][0]);
    for (const m of markers) end = Math.max(end, m.t);
    return end;
  }

  /**
   * The robot's clock can be years off, so only its elapsed part is usable.
   * Clears and status samples are stamped on the browser clock and share the
   * monotonic `lastT`, so the robot clock is rebased onto the browser origin.
   */
  function relativeTime(packet: TelemetryItem, wallElapsedMs: number): number {
    const ts = packet.timestamp;
    if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0)
      return wallElapsedMs;

    if (isNaN(robotT0)) {
      robotT0 = ts;
      robotWallBase = wallElapsedMs;
    }

    const t = ts - robotT0 + robotWallBase;
    if (t < 0 || t > 24 * 60 * 60 * 1000) return wallElapsedMs;
    return t;
  }

  return {
    addBatch(packets, wallElapsedMs) {
      if (packets.length === 0) {
        // The deliberate clearing primitive. Never compress these away: they are
        // the opmode pre-init reset, and dropping one bleeds stale keys across runs.
        data = {};
        log = [];
        // Pinned to the last packet rather than the browser clock: the two
        // drift, and later timestamps are clamped to Math.max(lastT, ...), so a
        // clear stamped ahead flattens the rest of the run onto one instant.
        if (isNaN(robotT0)) lastT = Math.max(lastT, wallElapsedMs);
        pushFrame([lastT, null, null, null, null, FLAG_CLEAR]);
        return;
      }

      for (const packet of packets) {
        const t = Math.max(lastT, relativeTime(packet, wallElapsedMs));
        lastT = t;

        let dataDelta: Record<string, string> | null = null;
        const packetData = packet.data ?? {};
        for (const k of Object.keys(packetData)) {
          const v = packetData[k];
          if (data[k] === v) continue;

          data[k] = v;
          if (dataDelta === null) dataDelta = {};
          dataDelta[String(keyIdx(k))] = v;
        }

        // No equality test: an empty-log packet never clears `log`, so
        // deduplicating drops a line that fired, went quiet and fired again.
        const packetLog = packet.log ?? [];
        let logDelta: string[] | null = null;
        if (packetLog.length > 0) {
          log = [...packetLog];
          logDelta = log;
        }

        const nextOverlay = ops.intern(packet.fieldOverlay?.ops ?? []);
        const nextField = ops.intern(packet.field?.ops ?? []);

        let extra: Record<string, unknown> | null = null;
        for (const k of Object.keys(packet)) {
          if (PACKET_KNOWN_FIELDS.has(k)) continue;
          if (extra === null) extra = {};
          extra[k] = (packet as unknown as Record<string, unknown>)[k];
        }
        const nextExtra = extra === null ? 0 : extras.intern(extra);

        const frame: Frame = [
          t,
          dataDelta,
          logDelta,
          nextOverlay === overlayRef ? null : nextOverlay,
          nextField === fieldRef ? null : nextField,
        ];
        if (nextExtra !== extraRef) {
          frame[5] = 0;
          frame[6] = nextExtra;
        }

        overlayRef = nextOverlay;
        fieldRef = nextField;
        extraRef = nextExtra;

        pushFrame(frame);
      }
    },

    addStatus(next, wallElapsedMs) {
      status.push([Math.max(0, wallElapsedMs), next]);
    },

    addMarker(marker) {
      if (markers.length >= MAX_TIMELINE_ENTRIES) return;
      markers.push(marker);
    },

    stats() {
      return {
        frames: frames.length,
        bytes: totalBytes(),
        durationMs: duration(),
      };
    },

    snapshot(meta) {
      return {
        v: RECORDING_VERSION,
        id: meta.id,
        meta: {
          ...meta,
          robotT0: isNaN(robotT0) ? 0 : robotT0,
          durationMs: duration(),
          frameCount: frames.length,
          bytes: totalBytes(),
        },
        keys: [...keys],
        dict: [...ops.values],
        xdict: [...extras.values],
        frames: [...frames],
        index: [...index],
        status: [...status],
        markers: [...markers],
      };
    },
  };
}

export type DecodedRecording = Recording;

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Every field is normalized: this is also the trust boundary for imported files. */
function decodeMeta(value: unknown, fallbackId: string): RecordingMeta {
  const m = (
    typeof value === 'object' && value !== null ? value : {}
  ) as Record<string, unknown>;
  const channels = (
    typeof m.channels === 'object' && m.channels !== null ? m.channels : {}
  ) as Record<string, unknown>;

  return {
    id: str(m.id, fallbackId),
    name: str(m.name, 'Recording').slice(0, 200),
    opMode: str(m.opMode, '').slice(0, 200),
    createdAt: num(m.createdAt, 0),
    robotT0: num(m.robotT0, 0),
    // A NaN or absurd duration would make every percentage in the transport bar
    // NaN and the scrub track unusable.
    durationMs: Math.max(
      0,
      Math.min(num(m.durationMs, 0), 24 * 60 * 60 * 1000),
    ),
    frameCount: Math.max(0, num(m.frameCount, 0)),
    bytes: Math.max(0, num(m.bytes, 0)),
    channels: {
      telemetry: channels.telemetry === true,
      field: channels.field === true,
    },
    origin: m.origin === 'imported' ? 'imported' : 'recorded',
    pinned: m.pinned === true,
  };
}

export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function clampDuration(value: number): number {
  return Math.max(0, Math.min(num(value, 0), MAX_DURATION_MS));
}

/** An index into `arr`, or null. Guards every dictionary dereference. */
function refIndex(value: unknown, length: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value >= length) return null;
  return value;
}

/**
 * Where an imported file stops being arbitrary JSON. Each slot has a crash
 * behind it: a string dict-ref resolves against the Array itself, a non-array
 * log throws inside the tick, a non-string delta reaches React as an object.
 */
function decodeFrame(
  f: unknown,
  keyCount: number,
  dictLength: number,
  xdictLength: number,
): Frame | null {
  if (!Array.isArray(f)) return null;

  const t = f[0];
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return null;

  let delta: Record<string, string> | null = null;
  const rawDelta = f[1];
  if (
    typeof rawDelta === 'object' &&
    rawDelta !== null &&
    !Array.isArray(rawDelta)
  ) {
    for (const k of Object.keys(rawDelta as Record<string, unknown>)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx >= keyCount) continue;

      const v = (rawDelta as Record<string, unknown>)[k];
      if (typeof v !== 'string') continue;

      if (delta === null) delta = {};
      delta[String(idx)] = v;
    }
  }

  const rawLog = f[2];
  const log = Array.isArray(rawLog)
    ? rawLog.filter((l): l is string => typeof l === 'string')
    : null;

  const out: Frame = [
    Math.min(t, MAX_DURATION_MS),
    delta,
    log,
    refIndex(f[3], dictLength),
    refIndex(f[4], dictLength),
  ];

  const flags = f[5];
  if (typeof flags === 'number' && Number.isFinite(flags)) {
    out[5] = flags & FLAG_CLEAR;
  }

  const extra = refIndex(f[6], xdictLength);
  if (extra !== null) {
    if (out[5] === undefined) out[5] = 0;
    out[6] = extra;
  }

  return out;
}

/**
 * Validates and normalizes, or null if this is not a recording. Every field is
 * rebuilt rather than cast: this is the only boundary between a shared file and
 * code that indexes arrays and spreads values into canvas ops.
 */
export function decode(value: unknown): DecodedRecording | null {
  if (typeof value !== 'object' || value === null) return null;

  const rec = value as Partial<Recording>;
  if (rec.v !== RECORDING_VERSION) return null;
  if (!Array.isArray(rec.frames)) return null;
  if (!Array.isArray(rec.dict) || !Array.isArray(rec.keys)) return null;

  const id = typeof rec.id === 'string' ? rec.id : 'recording';
  const meta = decodeMeta(rec.meta, id);

  // .map, never .filter: frame deltas address these by position, so dropping a
  // bad entry relabels every key after it.
  const keys = rec.keys.map((k) => (typeof k === 'string' ? k : ''));
  const dict = rec.dict.map((ops) => (Array.isArray(ops) ? ops : []));
  const xdict = Array.isArray(rec.xdict)
    ? rec.xdict.map((x) =>
        typeof x === 'object' && x !== null && !Array.isArray(x) ? x : {},
      )
    : [{}];

  // Keyframes address frames by position too, so one rejected frame shifts every
  // index after it. If any is unusable the whole index is dropped below.
  const decodedFrames = rec.frames.map((f) =>
    decodeFrame(f, keys.length, dict.length, xdict.length),
  );
  const droppedFrame = decodedFrames.some((f) => f === null);
  const keptFrames = decodedFrames.filter((f): f is Frame => f !== null);
  // Re-ordering invalidates kf.f as surely as dropping, and more quietly: the
  // indices stay in range while each names a different frame.
  const wasOrdered = keptFrames.every(
    (f, i) => i === 0 || keptFrames[i - 1][0] <= f[0],
  );
  // lastFrameAtOrBefore binary-searches this, so order is a correctness
  // requirement exactly as it is for the keyframe index.
  const frames = wasOrdered
    ? keptFrames
    : [...keptFrames].sort((a, b) => a[0] - b[0]);

  const status = Array.isArray(rec.status)
    ? rec.status
        .filter(
          (s): s is StatusSample =>
            Array.isArray(s) &&
            typeof s[0] === 'number' &&
            Number.isFinite(s[0]) &&
            s[0] >= 0 &&
            typeof s[1] === 'object' &&
            s[1] !== null,
        )
        // Clamped like frames and markers: recordedAnchor reads these to line
        // a recording up against a live run.
        .map((s): StatusSample => [Math.min(s[0], MAX_DURATION_MS), s[1]])
        // Generous: sampled once a second, so the 500 that bounds markers would
        // discard everything past 8m20s. This is also the only battery record.
        .slice(0, MAX_STATUS_SAMPLES)
    : [];

  const markers = Array.isArray(rec.markers)
    ? rec.markers
        .filter(
          (m): m is Marker =>
            typeof m === 'object' &&
            m !== null &&
            typeof m.t === 'number' &&
            Number.isFinite(m.t) &&
            m.t >= 0,
        )
        .map((m) => ({
          t: Math.min(m.t, MAX_DURATION_MS),
          kind:
            m.kind === 'error' || m.kind === 'opmode' || m.kind === 'log'
              ? m.kind
              : ('log' as const),
          text: str(m.text, '').slice(0, 500),
        }))
        .slice(0, MAX_TIMELINE_ENTRIES)
    : [];

  // The stored duration is a hint; trust the tracks, which the transport bar and
  // the end-of-playback check key off. Re-clamped, or the ruler loop hangs.
  let end = meta.durationMs;
  if (frames.length > 0) end = Math.max(end, frames[frames.length - 1][0]);
  if (status.length > 0) end = Math.max(end, status[status.length - 1][0]);
  for (const m of markers) end = Math.max(end, m.t);
  meta.durationMs = clampDuration(end);

  return {
    v: RECORDING_VERSION,
    id,
    meta,
    keys,
    dict,
    xdict,
    frames,
    index: (Array.isArray(rec.index) ? rec.index : [])
      .filter(
        (kf): kf is Keyframe =>
          typeof kf === 'object' &&
          kf !== null &&
          typeof kf.t === 'number' &&
          Number.isFinite(kf.t) &&
          typeof kf.data === 'object' &&
          kf.data !== null &&
          !Array.isArray(kf.data) &&
          Array.isArray(kf.log) &&
          // foldTo starts its walk at kf.f + 1 with no lower bound, so an
          // out-of-range index walks off the end of frames and throws out of the
          // scrubber's synchronous dispatch.
          refIndex(kf.f, frames.length) !== null &&
          refIndex(kf.o, dict.length) !== null &&
          refIndex(kf.fd, dict.length) !== null &&
          refIndex(kf.x, xdict.length) !== null,
      )
      .map((kf) => ({
        ...kf,
        data: Object.keys(kf.data).reduce<Record<string, string>>((acc, k) => {
          const v = kf.data[k];
          if (typeof v === 'string') acc[k] = v;
          return acc;
        }, {}),
        log: kf.log.filter((l): l is string => typeof l === 'string'),
      }))
      // keyframeFor binary-searches this, so order is a correctness requirement.
      .sort((a, b) => a.f - b.f)
      // See droppedFrame and wasOrdered: once positions have moved, every kf.f
      // is a lie.
      .filter(() => !droppedFrame && wasOrdered),
    status,
    markers,
  };
}

function applyFrame(rec: DecodedRecording, state: FoldedState, f: Frame) {
  if ((frameFlags(f) & FLAG_CLEAR) !== 0) {
    // FieldView's reduce is sticky and ignores empty batches, so a clear resets
    // telemetry text but leaves the last drawn overlay on the canvas.
    state.data = {};
    state.log = [];
    state.logFresh = false;
    return;
  }

  const delta = f[1];
  if (delta) {
    for (const idx of Object.keys(delta)) {
      const key = rec.keys[Number(idx)];
      if (key === undefined) continue;
      state.data[key] = delta[idx];
    }
  }

  const log = f[2];
  state.logFresh = Boolean(log);
  if (log) state.log = log;

  if (f[3] !== null && f[3] !== undefined) state.o = f[3];
  if (f[4] !== null && f[4] !== undefined) state.fd = f[4];

  const x = frameExtraRef(f);
  if (x !== null) state.x = x;
}

/** Index of the last frame with t <= tMs, or -1. */
function lastFrameAtOrBefore(frames: Frame[], tMs: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid][0] <= tMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found;
}

/** Nearest keyframe at or before frame index `target`, or null. */
function keyframeFor(rec: DecodedRecording, target: number): Keyframe | null {
  let lo = 0;
  let hi = rec.index.length - 1;
  let found: Keyframe | null = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rec.index[mid].f <= target) {
      found = rec.index[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found;
}

/** State as of `tMs`. Starts from the nearest keyframe, so it walks at most
 *  KEYFRAME_INTERVAL frames however long the recording is. */
export function foldTo(rec: DecodedRecording, tMs: number): FoldedState {
  const target = lastFrameAtOrBefore(rec.frames, tMs);
  const state: FoldedState = {
    data: {},
    log: [],
    logFresh: false,
    o: 0,
    fd: 0,
    x: 0,
    frameIdx: target,
  };

  if (target < 0) return state;

  const kf = keyframeFor(rec, target);
  let start = 0;

  if (kf) {
    state.data = { ...kf.data };
    state.log = [...kf.log];
    state.o = kf.o;
    state.fd = kf.fd;
    state.x = kf.x;
    // kf.f, not kf.f + 1: a keyframe does not record whether its own frame
    // carried a log. Re-applying is idempotent, every delta being a set.
    start = kf.f;
  }

  for (let i = start; i <= target; i++) {
    applyFrame(rec, state, rec.frames[i]);
  }

  return state;
}

/** Resolves a frame into the packet shape the views already consume. */
export function frameToPacket(
  rec: DecodedRecording,
  state: FoldedState,
  timestamp: number,
  /** `timestamp` cannot answer this: it is browser-epoch and scaled by playback
   *  speed, so a 4x replay would report the run as a quarter of its length. */
  recordedMs?: number,
): TelemetryItem {
  const extra = rec.xdict[state.x] ?? {};

  return {
    ...extra,
    timestamp,
    ...(recordedMs === undefined ? {} : { recordedMs }),
    data: { ...state.data },
    log: state.logFresh ? [...state.log] : [],
    field: { ops: rec.dict[state.fd] ?? [] },
    fieldOverlay: { ops: rec.dict[state.o] ?? [] },
  } as TelemetryItem;
}

export function isClearFrame(f: Frame): boolean {
  return (frameFlags(f) & FLAG_CLEAR) !== 0;
}

/** One thing to dispatch. A clear is its own segment, or folding it into a
 *  neighbouring batch would lose it. */
export type ReplaySegment =
  | { kind: 'clear' }
  | { kind: 'batch'; packets: TelemetryItem[] };

/** Walks `state` forward across an inclusive range, grouping into as few
 *  segments as possible. Used by playback ticks and post-seek prefill. */
export function foldRange(
  rec: DecodedRecording,
  state: FoldedState,
  fromIdx: number,
  toIdx: number,
  timestampFor: (t: number) => number,
): ReplaySegment[] {
  const segments: ReplaySegment[] = [];
  let current: TelemetryItem[] = [];

  const flush = () => {
    if (current.length === 0) return;
    segments.push({ kind: 'batch', packets: current });
    current = [];
  };

  for (let i = fromIdx; i <= toIdx; i++) {
    const f = rec.frames[i];
    applyFrame(rec, state, f);
    state.frameIdx = i;

    if (isClearFrame(f)) {
      flush();
      segments.push({ kind: 'clear' });
      continue;
    }

    current.push(frameToPacket(rec, state, timestampFor(f[0]), f[0]));
  }

  flush();
  return segments;
}

/** Converts a pre-v2 `field_replay_` array into a v2 recording. */
export function upgradeV1(
  legacy: unknown,
  id: string,
  name: string,
): Recording | null {
  if (!Array.isArray(legacy)) return null;

  // An array alone is not a recording, or any JSON array imports successfully
  // and lands in the library pinned, exempt from eviction.
  const looksLikeReplay = legacy.some(
    (e) =>
      typeof e === 'object' &&
      e !== null &&
      !Array.isArray(e) &&
      (Array.isArray((e as { ops?: unknown }).ops) ||
        Number.isFinite((e as { timestamp?: unknown }).timestamp as number)),
  );
  if (!looksLikeReplay) return null;

  const ops = new Interner<DrawOp[]>([]);
  const frames: Frame[] = [];
  const index: Keyframe[] = [];
  let lastT = 0;
  let overlayRef = 0;

  for (const entry of legacy) {
    if (typeof entry !== 'object' || entry === null) continue;

    const e = entry as { timestamp?: unknown; ops?: unknown };
    // Clamped like every other timestamp: an unbounded value here reaches
    // durationMs and pins the main thread in the transport bar's ruler loop, and
    // this path does not otherwise pass through decodeMeta.
    const t =
      typeof e.timestamp === 'number' && Number.isFinite(e.timestamp)
        ? Math.max(0, Math.min(e.timestamp, MAX_DURATION_MS))
        : lastT;
    const entryOps = Array.isArray(e.ops) ? (e.ops as DrawOp[]) : [];

    lastT = Math.max(lastT, t);
    const ref = ops.intern(entryOps);
    frames.push([lastT, null, null, ref === overlayRef ? null : ref, null]);
    overlayRef = ref;

    if (frames.length % KEYFRAME_INTERVAL === 0) {
      index.push({
        f: frames.length - 1,
        t: lastT,
        data: {},
        log: [],
        o: overlayRef,
        fd: 0,
        x: 0,
      });
    }
  }

  return {
    v: RECORDING_VERSION,
    id,
    meta: {
      id,
      name,
      opMode: '',
      createdAt: Date.now(),
      robotT0: 0,
      durationMs: lastT,
      frameCount: frames.length,
      bytes: 0,
      channels: { telemetry: false, field: true },
      origin: 'recorded',
      pinned: true,
    },
    keys: [],
    dict: [...ops.values],
    xdict: [{}],
    frames,
    index,
    status: [],
    markers: [],
  };
}

/** Same-origin relative paths only: Field.js assigns op.path straight to
 *  image.src. Normalized first, since the URL parser strips tab and newline. */
function safeImagePath(path: unknown): string | null {
  if (typeof path !== 'string') return null;

  const normalized = path.replace(/[\t\n\r]/g, '').trim();
  if (normalized === '') return null;
  if (normalized.includes('\\')) return null;

  try {
    const url = new URL(normalized, window.location.href);
    if (url.origin !== window.location.origin) return null;

    // Origin alone is not enough: `//attacker.example/x.gif` parses with THIS
    // origin, then image.src treats it as protocol-relative and fetches it.
    // Collapsing leading slashes leaves only a path on this origin.
    const pathname = '/' + url.pathname.replace(/^\/+/, '');
    return pathname + url.search;
  } catch {
    return null;
  }
}

/** Checking `type` alone is not enough: `{type: 'polyline'}` reaches
 *  `fineMoveTo(xPoints[0], ...)` on undefined and throws from React's commit
 *  phase, and there is no error boundary. */
const OP_NUMBERS: { [type: string]: string[] } = {
  scale: ['scaleX', 'scaleY'],
  rotation: ['rotation'],
  translate: ['x', 'y'],
  strokeWidth: ['width'],
  circle: ['x', 'y', 'radius'],
  spline: [
    'ax',
    'bx',
    'cx',
    'dx',
    'ex',
    'fx',
    'ay',
    'by',
    'cy',
    'dy',
    'ey',
    'fy',
  ],
  image: ['x', 'y', 'theta', 'pivotX', 'pivotY', 'width', 'height'],
  text: ['x', 'y', 'theta'],
  grid: [
    'x',
    'y',
    'theta',
    'X',
    'Y',
    'width',
    'height',
    'pivotX',
    'pivotY',
    'numTicksX',
    'numTicksY',
  ],
  alpha: ['alpha'],
};

const OP_STRINGS: { [type: string]: string[] } = {
  fill: ['color'],
  stroke: ['color'],
  text: ['font'],
};

/** Each becomes one absolutely positioned DOM node and an imported file may
 *  declare a million. Past a few hundred they overlap into a solid bar. */
const MAX_TIMELINE_ENTRIES = 500;

/** One per second of recording, and MAX_DURATION_MS is a day. */
const MAX_STATUS_SAMPLES = 100000;

/** Point arrays are walked index by index, so a huge length is a hang. */
const MAX_POINTS = 100000;

/** Laid out glyph by glyph on every repaint. Longer than any real label. */
const MAX_TEXT_LENGTH = 10000;

/** Drawn one line each, so the count is a loop bound: `numTicksX: 1e9` freezes
 *  the tab, and a real field grid is single digits. */
const MAX_TICKS = 1000;

function hasFiniteNumbers(op: object, fields: string[]): boolean {
  const rec = op as { [k: string]: unknown };
  return fields.every(
    (f) => typeof rec[f] === 'number' && Number.isFinite(rec[f] as number),
  );
}

function hasStrings(op: object, fields: string[]): boolean {
  const rec = op as { [k: string]: unknown };
  return fields.every((f) => typeof rec[f] === 'string');
}

function withinTickBudget(op: object): boolean {
  const rec = op as { numTicksX?: unknown; numTicksY?: unknown };
  return [rec.numTicksX, rec.numTicksY].every(
    (n) => typeof n === 'number' && n >= 0 && n <= MAX_TICKS,
  );
}

function finitePointArray(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length === 0 || v.length > MAX_POINTS) return null;
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  }
  return v as number[];
}

function sanitizeOps(ops: DrawOp[]): DrawOp[] {
  if (!Array.isArray(ops)) return [];

  const out: DrawOp[] = [];
  for (const op of ops) {
    if (typeof op !== 'object' || op === null) continue;

    const type = (op as { type?: unknown }).type as string;
    if (!KNOWN_OP_TYPES.has(type)) continue;

    if (OP_NUMBERS[type] && !hasFiniteNumbers(op, OP_NUMBERS[type])) continue;
    if (OP_STRINGS[type] && !hasStrings(op, OP_STRINGS[type])) continue;
    if (type === 'grid' && !withinTickBudget(op)) continue;
    // ctx.arc is specified to THROW on a negative radius, not to ignore it, and
    // it throws from inside FieldView's update, which React turns into a blank
    // dashboard. A finiteness check alone let that through.
    if (type === 'circle' && !((op as { radius: number }).radius >= 0))
      continue;

    if (type === 'polygon' || type === 'polyline') {
      const xPoints = finitePointArray(
        (op as unknown as { xPoints?: unknown }).xPoints,
      );
      const yPoints = finitePointArray(
        (op as unknown as { yPoints?: unknown }).yPoints,
      );
      if (!xPoints || !yPoints || xPoints.length !== yPoints.length) continue;

      out.push({ ...(op as object), xPoints, yPoints } as DrawOp);
      continue;
    }

    if ((op as { type: string }).type === 'image') {
      const path = safeImagePath((op as unknown as { path?: unknown }).path);
      if (path === null) continue;
      out.push({ ...(op as object), path } as DrawOp);
      continue;
    }

    if ((op as { type: string }).type === 'text') {
      const text = (op as unknown as { text?: unknown }).text;
      out.push({
        ...(op as object),
        // Bounded like point arrays and grid ticks: laid out glyph by glyph on
        // every repaint, so a huge string is a hang rather than a long label.
        text: typeof text === 'string' ? text.slice(0, MAX_TEXT_LENGTH) : '',
      } as DrawOp);
      continue;
    }

    out.push(op);
  }

  return out;
}

/**
 * Hardens a recording that came from a file. Deliberately does NOT HTML-escape
 * telemetry text, which React already escapes at render; what needs hardening is
 * what it does not cover -- draw ops that throw, and image paths.
 */
export function sanitizeImported(rec: Recording): Recording {
  return {
    ...rec,
    meta: {
      ...rec.meta,
      name: String(rec.meta?.name ?? 'Imported recording').slice(0, 200),
      opMode: String(rec.meta?.opMode ?? '').slice(0, 200),
      origin: 'imported',
    },
    dict: rec.dict.map(sanitizeOps),
    markers: rec.markers.map((m) => ({
      ...m,
      text: String(m.text ?? '').slice(0, 500),
    })),
  };
}
