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
// Fast enough that a tenths-of-a-second readout actually moves. The frame and
// byte counters ride along; they are cheap.
const STATS_INTERVAL_MS = 250;
const STATUS_SAMPLE_INTERVAL_MS = 1000;
/** A name is all that survives a disconnect, so re-running the same op mode
 *  inside this window rejoins rather than starting over. */
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
  /** Last status value written, so a change is always recorded. */
  lastStatusSampled: string | undefined;
  dirty: boolean;
  /** True once a save has succeeded, so a missing meta row means "deleted". */
  everSaved: boolean;
  /** Started by Record now. The status handler governs automatic capture only. */
  manual: boolean;
};

// Module scope rather than store state: frames are large and churn at 50 Hz.
let session: Session | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
/** Dropped out from under, kept in case it comes back: finalizing on
 *  disconnect cuts one match into two files. */
let suspended: Session | null = null;
let suspendedAt = 0;
/** What a session is capturing, so switching op modes ends one and starts the next. */
let armedOpMode: string | null = null;
/** Stopped by hand. The level-based trigger would otherwise re-arm next poll. */
let suppressedOpMode: string | null = null;

/** onOpModePreInit sets INIT for DefaultOpMode too, so an idle robot reports
 *  INIT/RUNNING with '$Stop$Robot$'. The tag guard is what makes a level
 *  trigger correct; an edge detector reads "armed" while idle. */
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
    // Hand-started sessions are pinned; automatic ones are not. evictAuto keys
    // purely on `pinned`, so leaving this false put a recording the user asked
    // for by name into the rolling ten-deep auto window and deleted it without
    // a word -- while the library's own caption promises that only automatic
    // recordings are ever evicted.
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

  // An empty session would take a slot in the auto-keep window from a real
  // match. Removing as well as declining to write, because a status sample
  // alone marks the session dirty and a flush may already have saved it.
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
      // A failed read says nothing about whether the row is there, and both
      // branches below need that answer. Stay dirty and let the next flush settle it.
      s.dirty = true;
      return;
    }

    // Absent after a successful save means the user deleted it mid-run; writing
    // again would resurrect it under the generated name for the rest of the match.
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

// Chunked flushes mean a crash, refresh or websocket drop costs one interval
// rather than the whole match.
function startTimers(store: Store) {
  clearTimers();
  flushTimer = setInterval(() => {
    if (session) void persist(store, session, false);
  }, FLUSH_INTERVAL_MS);
  statsTimer = setInterval(() => emitStats(store), STATS_INTERVAL_MS);
}

/**
 * Decides what to do with a suspended session now that the robot is talking
 * again: pick it back up, or close it and let normal arming start a new one.
 */
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

/** Closes a session that will not be rejoined, clearing the panel state too:
 *  the disconnect branch leaves the recorder reading 'active' on purpose. */
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

  // persist() declines to save a session that captured nothing, which is right:
  // an empty row would evict a real match under the rolling auto-keep window.
  // But the user asked for this one by name, so pressing Record now, waiting,
  // and pressing Stop has to explain the empty library rather than look like the
  // button did nothing. Automatic sessions stay silent; nobody asked for those.
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

/**
 * Records the live telemetry stream. Lives in middleware rather than in
 * RecorderView so recording keeps working when the Recorder tile is not in the
 * layout, and so it cannot leak an interval on unmount.
 */
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
        // Starting one by hand closes whatever the link interrupted, rather
        // than leaving it to rejoin under the new session a poll later.
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
        // Latch the current op mode so the next status poll does not simply
        // start recording the same match again under a second name.
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
        // Only the automatic sessions this setting governs. It reads "record
        // op modes automatically", so tearing down a session the user started
        // by hand with Record now is not what unchecking it asks for.
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

        // Before any arming decision: a suspended session must be settled
        // here, or the code below starts a second one.
        resumeOrRetire(api, runningOpMode);

        // Level-triggered: only the op mode *name* distinguishes a real run
        // from sitting in the pit. The latch clears once the robot moves on.
        if (suppressedOpMode !== null && runningOpMode !== suppressedOpMode) {
          suppressedOpMode = null;
        }

        const shouldRecord =
          runningOpMode !== null &&
          runningOpMode !== suppressedOpMode &&
          state.playback.recorder.enabled;

        // Only automatic sessions answer to the robot. A session the user
        // started by hand ends when the user says so, when a save fails, or
        // never; the 1 Hz poll has no opinion about it.
        if (
          session &&
          !session.manual &&
          (!shouldRecord || runningOpMode !== session.opMode)
        ) {
          // Also covers switching straight from one op mode to another.
          stopSession(api, true);
        }
        if (shouldRecord && !session) {
          startSession(api, runningOpMode ?? '', false);
        }

        if (session) {
          const t = elapsed(session);
          // Always on a state change, not only on the interval. The hub pushes
          // the RUNNING status the instant START is pressed, and the plain
          // interval gate dropped it whenever it landed inside a second of the
          // previous INIT sample. That edge is what compare mode lines two runs
          // up on, so losing it costs a second of accuracy in every recording.
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
        // A drop that spans one match ending and the next starting would leave the
        // first session open, so both matches plus the dead time between them land
        // in one file named after the first.
        if (!(action as { isConnected?: boolean }).isConnected) {
          armedOpMode = null;
          // A hand-started session survives a drop outright. Its whole purpose
          // is to capture a span the user chose, and a flaky link mid-span is a
          // reason to leave a gap, not to throw the span away.
          if (session && !session.manual) {
            // Flushed first, in case the link never comes back.
            void persist(api, session, false);
            suspended = session;
            suspendedAt = Date.now();
            session = null;
            clearTimers();
            // Deliberately still 'active': the recording is open, just not
            // hearing anything. Reporting it stopped and then started again
            // would flicker the panel through a state it was never really in.
          }
        }
        break;
      }

      // Reviewing does not stop capturing: this sits upstream of
      // playbackMiddleware, so it still sees live RECEIVE_TELEMETRY.

      case RECEIVE_TELEMETRY: {
        const telemetryAction = action as ReceiveTelemetryAction;
        // Replayed batches re-enter the chain from the top, so without this the
        // recorder would record its own playback back into the file.
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
