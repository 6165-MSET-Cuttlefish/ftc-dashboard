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

/** The tag guard is load-bearing: onOpModePreInit sets INIT for DefaultOpMode
 *  too, so an idle robot reports INIT/RUNNING with activeOpMode '$Stop$Robot$'. */
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

/** Where the run started. A recording begins at INIT, so its first seconds are
 *  dead air, and the status track is the only evidence of START. */
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

    // Only when the recording's first data lands just before the status edge:
    // an op mode telemetering from init_loop would snap to the init dwell.
    const firstData = firstPayloadTime(recording);
    const snap =
      firstData !== null && firstData <= t && t - firstData <= SNAP_WINDOW_MS
        ? firstData
        : null;

    return { recAnchorMs: t, recSnapMs: snap, source: 'start' };
  }

  // No RUNNING sample: fall back to the first frame that carried anything, which
  // is where the robot started talking. Off by the poll interval at worst.
  for (const f of recording.frames) {
    if (isClearFrame(f)) continue;
    if (f[1] || f[3] !== null || f[4] !== null) {
      return { recAnchorMs: f[0], recSnapMs: null, source: 'first-data' };
    }
  }

  return { recAnchorMs: 0, recSnapMs: null, source: 'none' };
}

/** Ties the playhead to the live run. startTimer derives wallStart from the
 *  cursor, so the mechanism is cursor = recAnchorMs + (now - liveAnchorWall). */
function alignToLiveRun(store: Store) {
  const { align, durationMs, speed } = store.getState().playback;
  if (align.recAnchorMs === null || liveAnchorWall === null) return;

  // Both sides snap or neither does. A one-sided snap turns a shared bias that
  // mostly cancels into a real error of up to a second.
  const bothSnap = align.recSnapMs !== null && liveSnapWall !== null;
  const recAnchor = bothSnap ? (align.recSnapMs as number) : align.recAnchorMs;
  const liveAnchor = bothSnap
    ? (liveSnapWall as number)
    : liveStatusWall ?? liveAnchorWall;

  // Any speed but 1x draws the recorded trace 1/speed as wide as its live twin
  // on a shared axis, so the shapes stop matching.
  if (speed !== 1) store.dispatch(setPlaybackSpeed(1));

  const elapsed = Date.now() - liveAnchor;
  const cursor = Math.max(0, Math.min(recAnchor + elapsed, durationMs));

  ghostEnded = false;
  store.dispatch(setAlign({ liveAnchorWall: liveAnchor, status: 'aligned' }));
  seekTo(store, cursor);
  startTimer(store, cursor);
}

/** Graph.add anchors its plot clock on browser wall time, so replayed samples
 *  must live on that scale; `t / speed` keeps the trace's width right. */
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

/** `recorded` separates a seek, which must discard what was accumulated or a
 *  backwards one duplicates rows, from a clear that was in the recording. */
function emitClear(store: Store, recorded = false) {
  // Ghost mode leaves every view on live data, so clearing here blanks it.
  if (store.getState().playback.mode === 'ghost') return;

  // The token, not the empty batch, is the durable signal: React batches this
  // with the dispatch that follows, so no view observes telemetry.length === 0.
  store.dispatch(recorded ? recordedClear() : resetTelemetryFold());
  emit(store, []);
  emit(store, [blankPacket()]);
}

/** Buckets encoded frame size over time so the transport bar can show activity. */
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

/** Every alpha, not just a leading op: Field.js applies alpha absolutely, so one
 *  set by the recorded op mode would overwrite it. */
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

  // Newest frame only, scanning past empty packets as FieldView's reduce does.
  // Searched separately: a packet routinely carries one and not the other.
  let ops: DrawOp[] | null = null;
  let data: { [key: string]: string } | null = null;

  outer: for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment.kind !== 'batch') continue;

    for (let j = segment.packets.length - 1; j >= 0; j--) {
      const packet = segment.packets[j];

      if (ops === null) {
        // fieldOverlay only: `field` is the background the dashboard seeds into
        // every packet, and a second copy covers the live robot and its trail.
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

  // Whichever track this batch had nothing for keeps what it was showing, or a
  // recording that draws and telemeters at different rates strobes.
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
      // Fresh array: TelemetryView keys on the reference, so a reused one reads
      // as frozen.
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

  // A seek re-opens the recording, so the end-of-ghost latch reopens too, or a
  // second lap skips the stop below and the timer runs until the tab closes.
  ghostEnded = false;

  const windowStart = Math.max(0, target - PREFILL_MS);
  const base = foldTo(rec, windowStart);

  // Hard-reset every view-local fold before re-seeding, so seeking backwards does
  // not leave keys from later in the run on screen.
  emitClear(store);

  const packets: TelemetryItem[] = [
    frameToPacket(rec, base, virtualTs(windowStart, speed), windowStart),
  ];

  const targetIdx = foldTo(rec, target).frameIdx;
  const segments = foldRange(rec, base, base.frameIdx + 1, targetIdx, (t) =>
    virtualTs(t, speed),
  );

  // One batch, not one dispatch per frame. At a 20 Hz scrub that would be roughly
  // 1600 dispatches a second, each re-running every view's fold.
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
  // Otherwise nothing: receiveTelemetry([]) is the clearing primitive, and a
  // 25 ms tick against a 10 Hz recording is idle most of the time.

  const now = Date.now();
  if (now - lastCursorDispatch >= CURSOR_DISPATCH_MS) {
    lastCursorDispatch = now;
    store.dispatch(tickPlayback(Math.min(cursor, durationMs)));
  }

  if (cursor >= durationMs && nextFrameIdx >= rec.frames.length) {
    const ghost = store.getState().playback.mode === 'ghost';

    if (ghost) {
      // Sticky is right per tick and wrong at the end of the file. Cleared once,
      // not per tick, which would strobe the field.
      if (!ghostEnded) {
        ghostEnded = true;
        // Field ops stay, telemetry goes: the path is still worth looking at,
        // while the graph's series would flatline and read as live data.
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
      // Through the action, not seekTo(): that leaves the cursor and fold token
      // untouched, so Logging appends a duplicate of the run every lap.
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
    // A malformed recording that reaches the fold would otherwise rethrow forty
    // times a second forever, with the cursor frozen and no way out.
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

/**
 * Repaints the Field without saying anything. timestamp 0 is LoggingView's
 * sentinel for a synthetic packet, and Graph.add refuses to anchor its plot
 * clock on a batch with no samples.
 */
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

/**
 * Swaps the source of `state.telemetry` while a recording plays. Every
 * telemetry-derived view is a pure function of that slice, so gating live
 * batches replays all of them at once. `state.status` stays live truth.
 */
const playbackMiddleware: Middleware<Record<string, unknown>, RootState> =
  (store) => (next) => (action) => {
    const api = store as unknown as Store;
    const before = store.getState().playback;

    switch (action.type) {
      case PLAYBACK_LOAD: {
        const id = (action as { id: string }).id;
        const result = next(action);

        // Captured before the await, so a slow decode cannot resurrect a
        // recording the user has already left.
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
                // Only the path that aligns may say so, or a mid-match swap
                // freezes the ghost at t=0 under a panel claiming otherwise.
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

        // The playhead belongs to the live run here, so Play means "line up
        // again"; falling through replays an old run over a robot mid-match.
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
        // The reducer short-circuits an unchanged mode, so the branch below
        // would stop the timer and rewind while the UI still reads Pause.
        if (requested === before.mode) return next(action);

        const result = next(action);
        const mode = store.getState().playback.mode;

        // The previous mode's sinks are handed back first, including on the
        // playback-to-ghost edge, which otherwise leaves a recorded frame
        // painted at full opacity and presented as the live robot.
        if (before.mode === 'ghost' || before.mode === 'playback') {
          resetSinks(api, before.mode);
        }

        // Unconditional and before the mode test: otherwise switching while
        // playing leaves an orphaned tick, and seekPlayback cannot restart it
        // because startTimer is gated on isPlaying, now false.
        stopTimer();

        if (mode === 'live') {
          // Not teardown(): the reducer keeps recordingId, so discarding the
          // decode leaves the store advertising a recording the engine lost.
        } else if (mode === 'ghost' && rec) {
          // Compare follows the live run, not the Play button: its claim only
          // holds if both clocks start at the same event.
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
        // Invalidates any in-flight load so it cannot pull us back in.
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

        // Re-render now rather than at the next frame: opacity is applied where
        // frames are dispatched, so the slider is dead while paused.
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

        // The robot sends nothing through init, so the first burst after a
        // silence is START to within a frame -- sharper than the 1 Hz poll.
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

            // The status edge and first packet race, and which wins is not
            // fixed, so refine whichever way round they arrive.
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

        // Dropped so the recording stays the only source while it plays. Ghost
        // mode does the comparison the other way round.
        return undefined;
      }

      case RECEIVE_ROBOT_STATUS: {
        // Never gated and never forged. The robot always wins: if something is
        // actually moving, you must not be staring at a recording.
        const result = next(action);

        const status = (action as ReceiveRobotStatusAction).status;
        const running = isOpModeActive(status);
        const started = running && !robotWasRunning;
        robotWasRunning = running;

        // RUNNING-only, unlike the test above: INIT to INIT is wrong by the
        // difference in how long each driver sat on the driver station.
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
            // The burst only counts if it began just before this edge. Traffic
            // during init would otherwise be mistaken for the start of the run.
            liveSnapWall =
              liveBurstStartWall !== null &&
              Math.abs(edge - liveBurstStartWall) <= SNAP_WINDOW_MS
                ? liveBurstStartWall
                : null;
            liveAnchorWall = liveSnapWall ?? edge;
            store.dispatch(setAlign({ liveAnchorWall }));
            // A new run restarts the comparison from the recorded start.
            if (store.getState().playback.mode === 'ghost') alignToLiveRun(api);
          }
        } else if (!liveRunning && liveWasRunning) {
          // A finished run is not an origin for the next one. Without this, the
          // next comparison would silently reuse an anchor from minutes ago.
          liveAnchorWall = null;
          liveStatusWall = null;
          liveSnapWall = null;
          store.dispatch(setAlign({ liveAnchorWall: null, status: 'waiting' }));
        }
        liveWasRunning = liveRunning;
        sawAnyStatus = true;

        // Edge-triggered: level would fire every poll and no one could stay in
        // playback while connected.
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
