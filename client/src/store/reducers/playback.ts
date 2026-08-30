import {
  PlaybackAction,
  PlaybackState,
  PLAYBACK_ERROR,
  PLAYBACK_SET_ALIGN,
  PLAYBACK_RECORDED_CLEAR,
  PLAYBACK_RESET_FOLD,
  PLAYBACK_EXIT,
  PLAYBACK_LOADED,
  PLAYBACK_PAUSE,
  PLAYBACK_PLAY,
  PLAYBACK_SEEK,
  PLAYBACK_SET_LOOP,
  PLAYBACK_SET_MODE,
  PLAYBACK_SET_OPACITY,
  PLAYBACK_SET_SPEED,
  PLAYBACK_TICK,
  RECORDER_SET_ENABLED,
  RECORDER_STATE,
} from '@/store/types/playback';

export const RECORDER_ENABLED_KEY = 'recorderEnabled';

function initialRecorderEnabled(): boolean {
  try {
    return window.localStorage.getItem(RECORDER_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

const initialState: PlaybackState = {
  mode: 'live',
  isPlaying: false,
  foldToken: 0,
  clearToken: 0,
  recordingId: null,
  meta: null,
  cursorMs: 0,
  durationMs: 0,
  speed: 1,
  loop: false,
  ghostOpacity: 0.5,
  markers: [],
  statusTimeline: [],
  density: [],
  recorder: {
    enabled: initialRecorderEnabled(),
    active: false,
    frames: 0,
    bytes: 0,
    elapsedMs: 0,
    durationMs: 0,
    id: null,
  },
  align: {
    recAnchorMs: null,
    recSnapMs: null,
    liveAnchorWall: null,
    source: 'none',
    status: 'waiting',
  },
  error: null,
};

/**
 * Compare mode stops following the live run once the playhead is moved by hand,
 * so align.status must not keep claiming 'aligned'. Only 'aligned' is
 * downgraded: 'waiting' is still true before a run starts, and entering the
 * mode seeks to zero, which would otherwise clobber it.
 */
function releaseAlign(state: PlaybackState): PlaybackState['align'] {
  if (state.mode !== 'ghost' || state.align.status !== 'aligned') {
    return state.align;
  }
  return { ...state.align, status: 'manual' };
}

const playbackReducer = (
  state = initialState,
  action: PlaybackAction,
): PlaybackState => {
  switch (action.type) {
    case PLAYBACK_LOADED:
      return {
        ...state,
        // Loading while in ghost mode keeps ghost: the user asked to compare a
        // recording against the live robot, not to replace it.
        mode: state.mode === 'ghost' ? 'ghost' : 'playback',
        isPlaying: false,
        recordingId: action.meta.id,
        meta: action.meta,
        cursorMs: 0,
        durationMs: action.durationMs,
        markers: action.markers,
        statusTimeline: action.statusTimeline,
        density: action.density,
        error: null,
      };

    case PLAYBACK_PLAY:
      if (state.mode === 'live' || state.recordingId === null) return state;
      return { ...state, isPlaying: true };

    case PLAYBACK_PAUSE:
      return { ...state, isPlaying: false, align: releaseAlign(state) };

    case PLAYBACK_SEEK: {
      const t = Math.max(0, Math.min(action.t, state.durationMs));
      // The fold token is not bumped here. The engine clears the sink as part of
      // seeking (seekTo -> emitClear -> PLAYBACK_RESET_FOLD), which keeps the
      // token tied to an actual clear rather than to an intent, so ghost-mode
      // seeks leave live data alone.
      return { ...state, cursorMs: t, align: releaseAlign(state) };
    }

    case PLAYBACK_TICK:
      return { ...state, cursorMs: action.cursorMs };

    case PLAYBACK_SET_SPEED:
      return { ...state, speed: action.speed };

    case PLAYBACK_SET_MODE:
      if (action.mode === state.mode) return state;
      return { ...state, mode: action.mode, isPlaying: false };

    case PLAYBACK_SET_OPACITY:
      return { ...state, ghostOpacity: action.opacity };

    case PLAYBACK_SET_LOOP:
      return { ...state, loop: action.loop };

    case PLAYBACK_EXIT:
      return {
        ...state,
        mode: 'live',
        isPlaying: false,
        align: initialState.align,
        recordingId: null,
        meta: null,
        cursorMs: 0,
        durationMs: 0,
        markers: [],
        statusTimeline: [],
        density: [],
        error: null,
      };

    case PLAYBACK_RESET_FOLD:
      return { ...state, foldToken: state.foldToken + 1 };

    case PLAYBACK_RECORDED_CLEAR:
      return { ...state, clearToken: state.clearToken + 1 };

    case PLAYBACK_SET_ALIGN:
      return { ...state, align: { ...state.align, ...action.align } };

    case PLAYBACK_ERROR:
      return { ...state, error: action.message };

    case RECORDER_STATE:
      return { ...state, recorder: { ...state.recorder, ...action.recorder } };

    case RECORDER_SET_ENABLED:
      return {
        ...state,
        recorder: { ...state.recorder, enabled: action.enabled },
      };

    default:
      return state;
  }
};

export default playbackReducer;
