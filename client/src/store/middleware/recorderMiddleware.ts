import { AnyAction, Dispatch, Middleware, MiddlewareAPI } from 'redux';

import OpModeStatus from '@/enums/OpModeStatus';
import { setPlaybackError, setRecorderState } from '@/store/actions/playback';
import {
  createEncoder,
  Encoder,
  RecordingMeta,
} from '@/store/recording/format';
import {
  evictAuto,
  loadMeta,
  newRecordingId,
  remove,
  save,
} from '@/store/recording/recordingStore';
import { RootState } from '@/store/reducers';
import {
  RECEIVE_CONNECTION_STATUS,
  RECEIVE_LOGCAT_ERRORS,
  RECEIVE_ROBOT_STATUS,
  RECEIVE_TELEMETRY,
  STOP_OP_MODE_TAG,
} from '@/store/types';
import { RECORDER_ENABLED_KEY } from '@/store/reducers/playback';
import {
  RECORDER_SET_ENABLED,
  RECORDER_START,
  RECORDER_STOP,
} from '@/store/types/playback';
import type { ReceiveTelemetryAction } from '@/store/types/telemetry';
import type { ReceiveRobotStatusAction } from '@/store/types/status';
import type { ReceiveLogcatErrorsAction } from '@/store/types/logcat';

const FLUSH_INTERVAL_MS = 5000;
// Fast enough that a tenths-of-a-second readout actually moves.
const STATS_INTERVAL_MS = 250;
const STATUS_SAMPLE_INTERVAL_MS = 1000;
/** Re-running the same op mode inside this window rejoins rather than starting over. */
const RESUME_WINDOW_MS = 30000;

type Session = {
  id: string;
  encoder: Encoder;
  wallT0: number;
  opMode: string;
  createdAt: number;
  sawTelemetry: boolean;
  sawField: boolean;
  lastStatusSampleMs: number;
  lastStatusSampled: string | undefined;
  dirty: boolean;
  /** True once a save has succeeded, so a missing meta row means "deleted". */
  everSaved: boolean;
  manual: boolean;
};

// Module scope rather than store state: frames are large and churn at 50 Hz.
let session: Session | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
/** Kept in case the link comes back: finalizing on disconnect cuts one match in two. */
let suspended: Session | null = null;
let suspendedAt = 0;
let armedOpMode: string | null = null;
/** Stopped by hand. The level-based trigger would otherwise re-arm next poll. */
let suppressedOpMode: string | null = null;

/** onOpModePreInit sets INIT for DefaultOpMode too, so an idle robot reports
 *  INIT/RUNNING with '$Stop$Robot$'; the tag guard is what makes this correct. */
function activeOpModeName(status: {
  activeOpMode?: string;
  activeOpModeStatus?: string;
}): string | null {
  if (!status) return null;
  if (!status.activeOpMode || status.activeOpMode === STOP_OP_MODE_TAG) {
    return null;
  }
  const running =
    status.activeOpModeStatus === OpModeStatus.INIT ||
    status.activeOpModeStatus === OpModeStatus.RUNNING;
  return running ? status.activeOpMode : null;
}

type Store = MiddlewareAPI<Dispatch<AnyAction>, RootState>;

function elapsed(s: Session): number {
  return Date.now() - s.wallT0;
}

function metaFor(
  s: Session,
): Omit<RecordingMeta, 'durationMs' | 'frameCount' | 'bytes'> {
  const stamp = new Date(s.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const label =
    `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(
      stamp.getDate(),
    )}` +
    ` ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(
      stamp.getSeconds(),
    )}`;

  return {
    id: s.id,
    name: s.opMode ? `${s.opMode} ${label}` : label,
    opMode: s.opMode,
    createdAt: s.createdAt,
    robotT0: 0,
    channels: { telemetry: s.sawTelemetry, field: s.sawField },
    origin: 'recorded',
    // evictAuto keys purely on `pinned`, so a false here puts a recording the user
    // asked for by name into the rolling ten-deep auto window.
    pinned: s.manual,
  };
}

function clearTimers() {
  if (flushTimer !== null) clearInterval(flushTimer);
  if (statsTimer !== null) clearInterval(statsTimer);
  flushTimer = null;
  statsTimer = null;
}

async function persist(store: Store, s: Session, final: boolean) {
  if (!s.dirty) return;
  s.dirty = false;

  // An empty session would take an auto-keep slot from a real match, and a flush
  // may already have saved it.
  if (final && s.encoder.stats().frames === 0) {
    if (s.everSaved) {
      try {
        await remove(s.id);
      } catch {
        // Best effort; a row that outlives this is deletable by hand.
      }
    }
    return;
  }

  try {
    let stored: RecordingMeta | null = null;
    try {
      stored = await loadMeta(s.id);
    } catch {
      // A failed read says nothing about the row either way; the next flush settles it.
      s.dirty = true;
      return;
    }

    // Absent after a successful save means the user deleted it mid-run.
    if (s.everSaved && !stored) {
      if (session === s) stopSession(store, false);
      return;
    }

    // Merged, or the next flush reverts a rename made while this was recording.
    const meta = metaFor(s);
    await save(
      s.encoder.snapshot(
        stored ? { ...meta, name: stored.name, pinned: stored.pinned } : meta,
      ),
    );
    s.everSaved = true;

    if (final) {
      await evictAuto(undefined, store.getState().playback.recordingId);
    }
  } catch (err) {
    store.dispatch(
      setPlaybackError(
        `Could not save recording: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
    if (session === s) {
      clearTimers();
      session = null;
      store.dispatch(setRecorderState({ active: false, id: null }));
    }
  }
}

function emitStats(store: Store) {
  const s = session;
  if (!s) return;

  const stats = s.encoder.stats();
  store.dispatch(
    setRecorderState({
      active: true,
      id: s.id,
      frames: stats.frames,
      bytes: stats.bytes,
      elapsedMs: elapsed(s),
      durationMs: stats.durationMs,
    }),
  );
}

function startSession(store: Store, opMode: string, manual: boolean) {
  if (session) return;

  const now = Date.now();
  session = {
    id: newRecordingId(),
    encoder: createEncoder(),
    wallT0: now,
    opMode,
    createdAt: now,
    sawTelemetry: false,
    sawField: false,
    lastStatusSampleMs: -Infinity,
    lastStatusSampled: undefined,
    dirty: false,
    everSaved: false,
    manual,
  };

  startTimers(store);

  store.dispatch(setRecorderState({ active: true, id: session.id }));
}

// Chunked flushes mean a crash or refresh costs one interval, not the whole match.
function startTimers(store: Store) {
  clearTimers();
  flushTimer = setInterval(() => {
    if (session) void persist(store, session, false);
  }, FLUSH_INTERVAL_MS);
  statsTimer = setInterval(() => emitStats(store), STATS_INTERVAL_MS);
}

function resumeOrRetire(store: Store, runningOpMode: string | null) {
  const s = suspended;
  if (!s) return;

  const rejoinable =
    session === null &&
    runningOpMode !== null &&
    runningOpMode === s.opMode &&
    Date.now() - suspendedAt <= RESUME_WINDOW_MS;

  suspended = null;

  if (rejoinable) {
    session = s;
    startTimers(store);
    store.dispatch(setRecorderState({ active: true, id: s.id }));
    return;
  }

  retire(store, s);
}

function retire(store: Store, s: Session) {
  void persist(store, s, true);
  store.dispatch(
    setRecorderState({
      active: false,
      frames: 0,
      bytes: 0,
      elapsedMs: 0,
      durationMs: 0,
      id: null,
    }),
  );
}

function stopSession(store: Store, finalize: boolean) {
  const s = session;
  clearTimers();
  session = null;

  if (s && finalize) void persist(store, s, true);

  // persist() silently declines to save a session that captured nothing, so a
  // hand-started one has to explain itself. Automatic sessions stay silent.
  if (s && finalize && s.manual && s.encoder.stats().frames === 0) {
    store.dispatch(
      setPlaybackError(
        'Nothing to record: the robot sent no telemetry while that was running. ' +
          'Telemetry only flows while an op mode is running.',
      ),
    );
  }

  store.dispatch(
    setRecorderState({
      active: false,
      frames: 0,
      bytes: 0,
      elapsedMs: 0,
      durationMs: 0,
      id: null,
    }),
  );
}

/** Middleware rather than RecorderView, so recording keeps working when the tile
 *  is not in the layout and cannot leak an interval on unmount. */
const recorderMiddleware: Middleware<Record<string, unknown>, RootState> =
  (store) => (next) => (action) => {
    // Observe only. Swallowing an action here would break downstream reducers.
    const result = next(action);
    const state = store.getState();
    const api = store as unknown as Store;

    switch (action.type) {
      case RECORDER_START: {
        const op = state.status.activeOpMode;
        suppressedOpMode = null;
        if (suspended) {
          const s = suspended;
          suspended = null;
          retire(api, s);
        }
        startSession(api, op && op !== STOP_OP_MODE_TAG ? op : '', true);
        break;
      }

      case RECORDER_STOP:
        if (suspended) {
          const s = suspended;
          suspended = null;
          retire(api, s);
        }
        // Latched, or the next status poll re-records the same match under a new name.
        suppressedOpMode = armedOpMode;
        stopSession(api, true);
        break;

      case RECORDER_SET_ENABLED: {
        const enabled = Boolean((action as { enabled: boolean }).enabled);
        try {
          window.localStorage.setItem(RECORDER_ENABLED_KEY, String(enabled));
        } catch {
          // A full or disabled localStorage just makes the preference per-session.
        }
        // The setting reads "record op modes automatically", so it governs only those.
        if (!enabled && suspended && !suspended.manual) {
          const s = suspended;
          suspended = null;
          retire(api, s);
        }
        if (!enabled && session && !session.manual) stopSession(api, true);
        break;
      }

      case RECEIVE_ROBOT_STATUS: {
        const status = (action as ReceiveRobotStatusAction).status;
        if (!status) break;

        const current = status.activeOpModeStatus ?? OpModeStatus.STOPPED;
        const runningOpMode = activeOpModeName(status);
        const previousOpMode = armedOpMode;
        armedOpMode = runningOpMode;

        // Must settle before any arming decision below, or a second session starts.
        resumeOrRetire(api, runningOpMode);

        // Level-triggered: only the op mode *name* separates a run from the pit.
        if (suppressedOpMode !== null && runningOpMode !== suppressedOpMode) {
          suppressedOpMode = null;
        }

        const shouldRecord =
          runningOpMode !== null &&
          runningOpMode !== suppressedOpMode &&
          state.playback.recorder.enabled;

        // Only automatic sessions answer to the robot; the 1 Hz poll has no opinion
        // about a hand-started one.
        if (
          session &&
          !session.manual &&
          (!shouldRecord || runningOpMode !== session.opMode)
        ) {
          stopSession(api, true);
        }
        if (shouldRecord && !session) {
          startSession(api, runningOpMode ?? '', false);
        }

        if (session) {
          const t = elapsed(session);
          // Always on a state change, not only on the interval: the hub pushes RUNNING
          // the instant START is pressed, and that edge is what compare mode aligns on.
          const changed =
            status.activeOpModeStatus !== session.lastStatusSampled;
          if (
            changed ||
            t - session.lastStatusSampleMs >= STATUS_SAMPLE_INTERVAL_MS
          ) {
            session.lastStatusSampled = status.activeOpModeStatus;
            session.lastStatusSampleMs = t;
            session.encoder.addStatus(
              {
                activeOpMode: status.activeOpMode,
                activeOpModeStatus: status.activeOpModeStatus,
                batteryVoltage: status.batteryVoltage,
              },
              t,
            );
            session.dirty = true;
          }

          if (previousOpMode !== runningOpMode || t === 0) {
            session.encoder.addMarker({
              t,
              kind: 'opmode',
              text: `${status.activeOpMode || 'opmode'} ${current}`,
            });
            session.dirty = true;
          }
        }
        break;
      }

      case RECEIVE_CONNECTION_STATUS: {
        // A drop spanning one match's end and the next's start would leave the first
        // session open, landing both matches in one file named after the first.
        if (!(action as { isConnected?: boolean }).isConnected) {
          armedOpMode = null;
          // A hand-started session captures a span the user chose, so a flaky link
          // mid-span is a reason to leave a gap rather than throw the span away.
          if (session && !session.manual) {
            // Flushed first, in case the link never comes back.
            void persist(api, session, false);
            suspended = session;
            suspendedAt = Date.now();
            session = null;
            clearTimers();
            // Deliberately still 'active': reporting stopped-then-started would
            // flicker the panel through a state it was never in.
          }
        }
        break;
      }

      // Upstream of playbackMiddleware, so reviewing does not stop capturing.

      case RECEIVE_TELEMETRY: {
        const telemetryAction = action as ReceiveTelemetryAction;
        // Replayed batches re-enter the chain from the top, so without this the
        // recorder records its own playback back into the file.
        if (telemetryAction.__replay) break;
        if (!session) break;

        const packets = telemetryAction.telemetry ?? [];
        // Zero-length batches are recorded too: they are the opmode pre-init
        // reset, and dropping one bleeds stale keys across runs.
        session.encoder.addBatch(packets, elapsed(session));
        session.dirty = true;

        for (const p of packets) {
          if (
            Object.keys(p.data ?? {}).length > 0 ||
            (p.log?.length ?? 0) > 0
          ) {
            session.sawTelemetry = true;
          }
          if ((p.fieldOverlay?.ops?.length ?? 0) > 0) session.sawField = true;
        }
        break;
      }

      case RECEIVE_LOGCAT_ERRORS: {
        if (!session) break;

        const errors = (action as ReceiveLogcatErrorsAction).errors ?? [];
        const t = elapsed(session);
        for (const e of errors) {
          session.encoder.addMarker({
            t,
            kind: e.level === 'ERROR' ? 'error' : 'log',
            text: `${e.tag}: ${e.message}`.slice(0, 500),
          });
        }
        if (errors.length > 0) session.dirty = true;
        break;
      }

      default:
        break;
    }

    return result;
  };

export default recorderMiddleware;
