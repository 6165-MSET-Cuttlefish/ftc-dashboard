import { AnyAction, Dispatch, Middleware, MiddlewareAPI } from 'redux';

import OpModeStatus from '@/enums/OpModeStatus';
import {
  exitPlayback,
  pausePlayback,
  recordingLoaded,
  recordedClear,
  resetTelemetryFold,
  seekPlayback,
  setAlign,
  setPlaybackSpeed,
  setPlaybackError,
  tickPlayback,
} from '@/store/actions/playback';
import { setReplayOverlay } from '@/store/actions/replay';
import {
  DecodedRecording,
  foldRange,
  FoldedState,
  foldTo,
  frameToPacket,
  isClearFrame,
  ReplaySegment,
} from '@/store/recording/format';
import type { DrawOp } from '@/store/types/telemetry';
import { load } from '@/store/recording/recordingStore';
import { RootState } from '@/store/reducers';
import {
  RECEIVE_ROBOT_STATUS,
  RECEIVE_TELEMETRY,
  STOP_OP_MODE_TAG,
} from '@/store/types';
import {
  PLAYBACK_EXIT,
  PLAYBACK_LOAD,
  PLAYBACK_PAUSE,
  PLAYBACK_PLAY,
  PLAYBACK_SEEK,
  PLAYBACK_SET_MODE,
  PLAYBACK_SET_OPACITY,
  PLAYBACK_SET_SPEED,
} from '@/store/types/playback';
import type { AlignState } from '@/store/types/playback';
import type {
  ReceiveTelemetryAction,
  Telemetry,
  TelemetryItem,
} from '@/store/types/telemetry';
import type { ReceiveRobotStatusAction } from '@/store/types/status';

const TICK_MS = 25;
const CURSOR_DISPATCH_MS = 100;

/** How much history to re-send after a seek so the graph has a window to draw. */
const PREFILL_MS = 8000;

type Store = MiddlewareAPI<Dispatch<AnyAction>, RootState>;

// Module scope rather than store state: frames are large and churn at 50 Hz.
let rec: DecodedRecording | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let fold: FoldedState | null = null;
let nextFrameIdx = 0;
let wallStart = 0;
let lastCursorDispatch = 0;
/** The true cursor; state.playback.cursorMs is throttled and lags by up to 400 ms at 4x. */
let liveCursorMs = 0;
/** Invalidates in-flight loads, so a slow decode cannot resurrect an exited recording. */
let loadSeq = 0;
let robotWasRunning = false;
/** Date.now() at the live START. RUNNING-only: INIT to INIT is wrong by the init dwell. */
let liveAnchorWall: number | null = null;
let liveWasRunning = false;
/** A first status of RUNNING is not an edge; the run began at an unknown time. */
let sawAnyStatus = false;
let lastLivePayloadWall = 0;
/** A burst after a gap is what START looks like: silence through init, then telemetry. */
let liveBurstStartWall: number | null = null;
let liveStatusWall: number | null = null;
let liveSnapWall: number | null = null;
let ghostEnded = false;
/** Raw ops, before opacity: the stored overlay has it baked in, so re-scaling compounds. */
let lastGhostOps: DrawOp[] | null = null;

/** The tag guard is load-bearing: an idle robot is '$Stop$Robot$' in INIT or RUNNING. */
function isOpModeActive(status: {
  activeOpMode?: string;
  activeOpModeStatus?: string;
}): boolean {
  if (!status) return false;
  if (status.activeOpMode === STOP_OP_MODE_TAG) return false;
  if (!status.activeOpMode) return false;
  return (
    status.activeOpModeStatus === OpModeStatus.INIT ||
    status.activeOpModeStatus === OpModeStatus.RUNNING
  );
}

/** A burst this close to the RUNNING edge is START; a longer silence splits bursts. */
const SNAP_WINDOW_MS = 1500;

function firstPayloadTime(recording: DecodedRecording): number | null {
  for (const f of recording.frames) {
    if (isClearFrame(f)) continue;
    if (f[1] || f[3] !== null || f[4] !== null) return f[0];
  }
  return null;
}

function recordedAnchor(recording: DecodedRecording): {
  recAnchorMs: number;
  recSnapMs: number | null;
  source: AlignState['source'];
} {
  for (const [t, status] of recording.status) {
    if (status.activeOpModeStatus !== OpModeStatus.RUNNING) continue;
    if (!status.activeOpMode || status.activeOpMode === STOP_OP_MODE_TAG) {
      continue;
    }

    // Only when the first data lands just before the status edge, or an op mode
    // telemetering from init_loop snaps to the init dwell.
    const firstData = firstPayloadTime(recording);
    const snap =
      firstData !== null && firstData <= t && t - firstData <= SNAP_WINDOW_MS
        ? firstData
        : null;

    return { recAnchorMs: t, recSnapMs: snap, source: 'start' };
  }

  // No RUNNING sample: the first frame carrying anything is off by one poll at worst.
  for (const f of recording.frames) {
    if (isClearFrame(f)) continue;
    if (f[1] || f[3] !== null || f[4] !== null) {
      return { recAnchorMs: f[0], recSnapMs: null, source: 'first-data' };
    }
  }

  return { recAnchorMs: 0, recSnapMs: null, source: 'none' };
}

/** Ties the playhead to the live run: cursor = recorded anchor + (now - live anchor). */
function alignToLiveRun(store: Store) {
  const { align, durationMs, speed } = store.getState().playback;
  if (align.recAnchorMs === null || liveAnchorWall === null) return;

  // Both sides snap or neither: a shared bias cancels, and a one-sided snap exposes it.
  const bothSnap = align.recSnapMs !== null && liveSnapWall !== null;
  const recAnchor = bothSnap ? (align.recSnapMs as number) : align.recAnchorMs;
  const liveAnchor = bothSnap
    ? (liveSnapWall as number)
    : liveStatusWall ?? liveAnchorWall;

  // Any speed but 1x draws the recorded trace 1/speed as wide as its live twin.
  if (speed !== 1) store.dispatch(setPlaybackSpeed(1));

  const elapsed = Date.now() - liveAnchor;
  const cursor = Math.max(0, Math.min(recAnchor + elapsed, durationMs));

  ghostEnded = false;
  store.dispatch(setAlign({ liveAnchorWall: liveAnchor, status: 'aligned' }));
  seekTo(store, cursor);
  startTimer(store, cursor);
}

/** Graph.add's plot clock runs on wall time, and this is the wall time t plays at. */
function virtualTs(t: number, speed: number): number {
  return wallStart + t / speed;
}

function emit(store: Store, telemetry: Telemetry) {
  const action: ReceiveTelemetryAction = {
    type: RECEIVE_TELEMETRY,
    telemetry,
    __replay: true,
  };
  store.dispatch(action);
}

/** `recorded` separates a clear that was in the recording from a seek, which must
 *  discard what was accumulated or a backwards one duplicates rows. */
function emitClear(store: Store, recorded = false) {
  // Ghost mode leaves every view on live data, so clearing here blanks it.
  if (store.getState().playback.mode === 'ghost') return;

  // The token, not the empty batch: React batches this with the dispatch that follows.
  store.dispatch(recorded ? recordedClear() : resetTelemetryFold());
  emit(store, []);
  emit(store, [blankPacket()]);
}

function computeDensity(recording: DecodedRecording, buckets = 60): number[] {
  const out = new Array(buckets).fill(0);
  const duration = recording.meta.durationMs;
  if (duration <= 0) return out;

  for (const f of recording.frames) {
    const bucket = Math.min(
      buckets - 1,
      Math.floor((f[0] / duration) * buckets),
    );
    out[bucket] += JSON.stringify(f).length;
  }

  return out;
}

/** Every alpha, not just a leading op: Field.js applies alpha absolutely. */
function withGhostOpacity(ops: DrawOp[], opacity: number): DrawOp[] {
  return [
    { type: 'alpha', alpha: opacity } as DrawOp,
    ...ops.map((op) =>
      op.type === 'alpha' ? { ...op, alpha: op.alpha * opacity } : op,
    ),
  ];
}

function dispatchGhost(store: Store, segments: ReplaySegment[]) {
  const { ghostOpacity } = store.getState().playback;

  // Searched separately: a packet routinely carries ops and not data, or the reverse.
  let ops: DrawOp[] | null = null;
  let data: { [key: string]: string } | null = null;

  outer: for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment.kind !== 'batch') continue;

    for (let j = segment.packets.length - 1; j >= 0; j--) {
      const packet = segment.packets[j];

      if (ops === null) {
        // fieldOverlay only: a second copy of the seeded `field` background would
        // cover the live robot and its trail.
        const packetOps = [...(packet.fieldOverlay?.ops ?? [])];
        if (packetOps.length > 0) {
          lastGhostOps = packetOps;
          ops = withGhostOpacity(packetOps, ghostOpacity);
        }
      }

      if (data === null && Object.keys(packet.data).length > 0) {
        data = packet.data;
      }

      if (ops !== null && data !== null) break outer;
    }
  }

  if (ops === null && data === null) return;

  // Each track keeps what it was showing, or an uneven recording strobes.
  const current = store.getState().replay;
  store.dispatch(setReplayOverlay(ops ?? current.ops, data ?? current.data));
}

function dispatchSegments(store: Store, segments: ReplaySegment[]) {
  if (store.getState().playback.mode === 'ghost') {
    dispatchGhost(store, segments);
    return;
  }

  for (const segment of segments) {
    if (segment.kind === 'clear') {
      emitClear(store, true);
    } else {
      // Fresh array: TelemetryView keys on the reference, so a reused one reads as frozen.
      emit(store, [...segment.packets]);
    }
  }
}

function stopTimer() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function teardown() {
  stopTimer();
  rec = null;
  fold = null;
  nextFrameIdx = 0;
  lastGhostOps = null;
}

function seekTo(store: Store, tMs: number) {
  if (!rec) return;

  const { speed } = store.getState().playback;
  const target = Math.max(0, Math.min(tMs, rec.meta.durationMs));
  wallStart = Date.now() - target / speed;

  // Reopened with the recording, or a second lap skips the stop and the timer never ends.
  ghostEnded = false;

  const windowStart = Math.max(0, target - PREFILL_MS);
  const base = foldTo(rec, windowStart);

  // Reset before re-seeding, or seeking backwards leaves later keys on screen.
  emitClear(store);

  const packets: TelemetryItem[] = [
    frameToPacket(rec, base, virtualTs(windowStart, speed), windowStart),
  ];

  const targetIdx = foldTo(rec, target).frameIdx;
  const segments = foldRange(rec, base, base.frameIdx + 1, targetIdx, (t) =>
    virtualTs(t, speed),
  );

  // One batch: per frame, a 20 Hz scrub would re-run every fold ~1600 times a second.
  const merged: ReplaySegment[] = [];
  let pending = packets;
  for (const segment of segments) {
    if (segment.kind === 'clear') {
      if (pending.length > 0) {
        merged.push({ kind: 'batch', packets: pending });
        pending = [];
      }
      merged.push({ kind: 'clear' });
    } else {
      pending = pending.concat(segment.packets);
    }
  }
  if (pending.length > 0) merged.push({ kind: 'batch', packets: pending });

  dispatchSegments(store, merged);

  fold = base;
  nextFrameIdx = targetIdx + 1;
  lastCursorDispatch = 0;
  liveCursorMs = target;
}

function tickInner(store: Store) {
  if (!rec || !fold) return;

  const { speed, loop, durationMs } = store.getState().playback;
  const cursor = (Date.now() - wallStart) * speed;
  liveCursorMs = cursor;

  let lastIdx = nextFrameIdx - 1;
  while (
    lastIdx + 1 < rec.frames.length &&
    rec.frames[lastIdx + 1][0] <= cursor
  ) {
    lastIdx += 1;
  }

  if (lastIdx >= nextFrameIdx) {
    const segments = foldRange(rec, fold, nextFrameIdx, lastIdx, (t) =>
      virtualTs(t, speed),
    );
    nextFrameIdx = lastIdx + 1;
    dispatchSegments(store, segments);
  }
  // No else: an idle tick emits no telemetry, as receiveTelemetry([]) would clear.

  const now = Date.now();
  if (now - lastCursorDispatch >= CURSOR_DISPATCH_MS) {
    lastCursorDispatch = now;
    store.dispatch(tickPlayback(Math.min(cursor, durationMs)));
  }

  if (cursor >= durationMs && nextFrameIdx >= rec.frames.length) {
    const ghost = store.getState().playback.mode === 'ghost';

    if (ghost) {
      // Cleared once, not per tick, which would strobe the field.
      if (!ghostEnded) {
        ghostEnded = true;
        // Field ops stay, telemetry goes: the graph would flatline and read as live.
        const { ghostOpacity: op } = store.getState().playback;
        store.dispatch(
          setReplayOverlay(
            lastGhostOps ? withGhostOpacity(lastGhostOps, op) : [],
            {},
          ),
        );
        stopTimer();
        store.dispatch(tickPlayback(durationMs));
        store.dispatch(pausePlayback());
      }
      return;
    }

    if (loop) {
      // Dispatched, not called: the store cursor rewinds now rather than a tick later.
      store.dispatch(seekPlayback(0));
    } else {
      stopTimer();
      store.dispatch(tickPlayback(durationMs));
      store.dispatch(pausePlayback());
    }
  }
}

function tick(store: Store) {
  try {
    tickInner(store);
  } catch (err) {
    // A malformed recording would otherwise rethrow forty times a second forever.
    stopTimer();
    store.dispatch(
      setPlaybackError(
        `Playback stopped: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    store.dispatch(pausePlayback());
  }
}

function startTimer(store: Store, fromMs?: number) {
  stopTimer();
  const { cursorMs, speed } = store.getState().playback;
  const from = fromMs ?? cursorMs;
  wallStart = Date.now() - from / speed;
  liveCursorMs = from;
  timer = setInterval(() => tick(store), TICK_MS);
}

/** timestamp 0 is LoggingView's sentinel for a synthetic packet, and Graph.add
 *  refuses to anchor its plot clock on a batch with no samples. */
function blankPacket(): TelemetryItem {
  return {
    timestamp: 0,
    data: {},
    log: [],
    field: { ops: [] },
    fieldOverlay: { ops: [{ type: 'alpha', alpha: 1 }] },
  };
}

function resetSinks(store: Store, fromMode: 'ghost' | 'playback') {
  store.dispatch(setReplayOverlay([]));
  if (fromMode !== 'playback') return;

  store.dispatch(resetTelemetryFold());
  emit(store, []);
  emit(store, [blankPacket()]);
}

/** Gating `state.telemetry` replays every view reading it; `state.status` stays live. */
const playbackMiddleware: Middleware<Record<string, unknown>, RootState> =
  (store) => (next) => (action) => {
    const api = store as unknown as Store;
    const before = store.getState().playback;

    switch (action.type) {
      case PLAYBACK_LOAD: {
        const id = (action as { id: string }).id;
        const result = next(action);

        const seq = ++loadSeq;

        void load(id)
          .then((loaded) => {
            if (seq !== loadSeq) return;

            if (!loaded) {
              store.dispatch(
                setPlaybackError('Could not load that recording.'),
              );
              return;
            }

            stopTimer();
            rec = loaded;
            fold = null;
            nextFrameIdx = 0;
            store.dispatch(
              recordingLoaded(
                loaded.meta,
                loaded.meta.durationMs,
                loaded.markers,
                loaded.status,
                computeDensity(loaded),
              ),
            );

            const { recAnchorMs, recSnapMs, source } = recordedAnchor(loaded);
            const canAlign =
              store.getState().playback.mode === 'ghost' &&
              liveAnchorWall !== null &&
              recAnchorMs !== null;

            store.dispatch(
              setAlign({
                recAnchorMs,
                recSnapMs,
                source,
                liveAnchorWall,
                // Gated, or a mid-match swap shows 'aligned' over a ghost stuck at t=0.
                status: canAlign
                  ? 'aligned'
                  : liveAnchorWall === null
                  ? 'waiting'
                  : 'unaligned',
              }),
            );

            if (canAlign) {
              alignToLiveRun(api);
            } else {
              seekTo(api, 0);
            }
          })
          .catch((err) => {
            if (seq !== loadSeq) return;
            store.dispatch(
              setPlaybackError(
                err instanceof Error ? err.message : String(err),
              ),
            );
          });

        return result;
      }

      case PLAYBACK_PLAY: {
        const result = next(action);
        const { mode, cursorMs, durationMs, align } = store.getState().playback;

        // The playhead belongs to the live run here, so Play means "line up again".
        if (
          mode === 'ghost' &&
          rec &&
          liveAnchorWall !== null &&
          align.recAnchorMs !== null
        ) {
          alignToLiveRun(api);
          return result;
        }

        if (mode !== 'live' && rec) {
          if (durationMs > 0 && cursorMs >= durationMs) {
            // Dispatched, not called: seekTo leaves the store cursor stale, so
            // startTimer would re-anchor there and dump the run in one batch.
            store.dispatch(seekPlayback(0));
          } else {
            startTimer(api);
          }
        }
        return result;
      }

      case PLAYBACK_PAUSE: {
        stopTimer();
        return next(action);
      }

      case PLAYBACK_SEEK: {
        const result = next(action);
        seekTo(api, store.getState().playback.cursorMs);
        if (store.getState().playback.isPlaying) startTimer(api);
        return result;
      }

      case PLAYBACK_SET_SPEED: {
        const atChange = liveCursorMs;
        const result = next(action);
        // Re-anchor from the true cursor, not the throttled one in the store.
        if (store.getState().playback.isPlaying) startTimer(api, atChange);
        return result;
      }

      case PLAYBACK_SET_MODE: {
        const requested = (action as { mode: string }).mode;
        // The reducer short-circuits an unchanged mode, so the branch below would rewind.
        if (requested === before.mode) return next(action);

        const result = next(action);
        const mode = store.getState().playback.mode;

        // Handed back first, including on the playback-to-ghost edge, which otherwise
        // leaves a recorded frame at full opacity presented as the live robot.
        if (before.mode === 'ghost' || before.mode === 'playback') {
          resetSinks(api, before.mode);
        }

        // Before the mode test: switching while playing otherwise leaves an orphaned
        // tick, and startTimer is gated on isPlaying, now false.
        stopTimer();

        if (mode === 'live') {
          // Not teardown(): the reducer keeps recordingId, so discarding the
          // decode leaves the store advertising a recording the engine lost.
        } else if (mode === 'ghost' && rec) {
          // Compare's claim only holds if both clocks start at the same event.
          if (liveAnchorWall !== null) {
            alignToLiveRun(api);
          } else {
            store.dispatch(setAlign({ status: 'waiting' }));
            store.dispatch(seekPlayback(0));
          }
        } else if (rec) {
          store.dispatch(seekPlayback(0));
        }

        return result;
      }

      case PLAYBACK_EXIT: {
        const wasMode = before.mode;
        loadSeq += 1;
        teardown();
        const result = next(action);

        if (wasMode === 'ghost' || wasMode === 'playback') {
          resetSinks(api, wasMode);
        }

        return result;
      }

      case PLAYBACK_SET_OPACITY: {
        const result = next(action);

        // Re-applied now: opacity rides on frames, and none are dispatched while paused.
        if (
          store.getState().playback.mode === 'ghost' &&
          lastGhostOps !== null
        ) {
          const { ghostOpacity } = store.getState().playback;
          store.dispatch(
            setReplayOverlay(
              withGhostOpacity(lastGhostOps, ghostOpacity),
              store.getState().replay.data,
            ),
          );
        }

        return result;
      }

      case RECEIVE_TELEMETRY: {
        const telemetryAction = action as ReceiveTelemetryAction;
        if (telemetryAction.__replay) return next(action);

        // The robot sends nothing through init, so the first burst after a silence
        // is START to within a frame, sharper than the 1 Hz poll.
        const carriesPayload = (telemetryAction.telemetry ?? []).some(
          (p) =>
            Object.keys(p.data ?? {}).length > 0 ||
            (p.fieldOverlay?.ops?.length ?? 0) > 0 ||
            (p.field?.ops?.length ?? 0) > 0,
        );
        if (carriesPayload) {
          const now = Date.now();
          if (now - lastLivePayloadWall > SNAP_WINDOW_MS) {
            liveBurstStartWall = now;

            // The status edge and first packet race, so refine either way round.
            if (
              liveStatusWall !== null &&
              liveSnapWall === null &&
              Math.abs(now - liveStatusWall) <= SNAP_WINDOW_MS
            ) {
              liveSnapWall = now;
              if (store.getState().playback.mode === 'ghost') {
                alignToLiveRun(api);
              }
            }
          }
          lastLivePayloadWall = now;
        }

        if (before.mode !== 'playback') return next(action);

        // Dropped so the recording stays the only source while it plays.
        return undefined;
      }

      case RECEIVE_ROBOT_STATUS: {
        // Never gated or forged: a moving robot always wins over a recording.
        const result = next(action);

        const status = (action as ReceiveRobotStatusAction).status;
        const running = isOpModeActive(status);
        const started = running && !robotWasRunning;
        robotWasRunning = running;

        const liveRunning =
          !!status &&
          status.activeOpModeStatus === OpModeStatus.RUNNING &&
          !!status.activeOpMode &&
          status.activeOpMode !== STOP_OP_MODE_TAG;

        if (liveRunning && !liveWasRunning) {
          if (!sawAnyStatus) {
            // Joined mid-run. Refuse rather than invent an origin.
            store.dispatch(setAlign({ status: 'unaligned' }));
          } else {
            const edge = Date.now();
            liveStatusWall = edge;
            // Counts only if the burst began just before this edge, not during init.
            liveSnapWall =
              liveBurstStartWall !== null &&
              Math.abs(edge - liveBurstStartWall) <= SNAP_WINDOW_MS
                ? liveBurstStartWall
                : null;
            liveAnchorWall = liveSnapWall ?? edge;
            store.dispatch(setAlign({ liveAnchorWall }));
            if (store.getState().playback.mode === 'ghost') alignToLiveRun(api);
          }
        } else if (!liveRunning && liveWasRunning) {
          // A finished run is not an origin: the next comparison would reuse it.
          liveAnchorWall = null;
          liveStatusWall = null;
          liveSnapWall = null;
          store.dispatch(setAlign({ liveAnchorWall: null, status: 'waiting' }));
        }
        liveWasRunning = liveRunning;
        sawAnyStatus = true;

        // Edge-triggered: level would fire every poll and bar playback while connected.
        if (started && before.mode === 'playback') {
          store.dispatch(exitPlayback());
          store.dispatch(
            setPlaybackError('Left replay: an op mode started on the robot.'),
          );
        }

        return result;
      }

      default:
        return next(action);
    }
  };

export default playbackMiddleware;
