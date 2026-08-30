import type {
  Marker,
  RecordingMeta,
  StatusSample,
} from '@/store/recording/format';
import {
  PlaybackErrorAction,
  PlaybackSetAlignAction,
  AlignState,
  PlaybackResetFoldAction,
  PlaybackExitAction,
  PlaybackLoadAction,
  PlaybackLoadedAction,
  PlaybackMode,
  PlaybackPauseAction,
  PlaybackPlayAction,
  PlaybackSeekAction,
  PlaybackSetLoopAction,
  PlaybackSetModeAction,
  PlaybackSetOpacityAction,
  PlaybackSetSpeedAction,
  PlaybackTickAction,
  PLAYBACK_ERROR,
  PLAYBACK_SET_ALIGN,
  PLAYBACK_RECORDED_CLEAR,
  PLAYBACK_RESET_FOLD,
  PLAYBACK_EXIT,
  PLAYBACK_LOAD,
  PLAYBACK_LOADED,
  PLAYBACK_PAUSE,
  PLAYBACK_PLAY,
  PLAYBACK_SEEK,
  PLAYBACK_SET_LOOP,
  PLAYBACK_SET_MODE,
  PLAYBACK_SET_OPACITY,
  PLAYBACK_SET_SPEED,
  PLAYBACK_TICK,
  RecorderSetEnabledAction,
  RecorderStartAction,
  RecorderState,
  RecorderStateAction,
  RecorderStopAction,
  RECORDER_SET_ENABLED,
  RECORDER_START,
  RECORDER_STATE,
  RECORDER_STOP,
} from '@/store/types/playback';

export const loadRecording = (id: string): PlaybackLoadAction => ({
  type: PLAYBACK_LOAD,
  id,
});

export const recordingLoaded = (
  meta: RecordingMeta,
  durationMs: number,
  markers: Marker[],
  statusTimeline: StatusSample[],
  density: number[],
): PlaybackLoadedAction => ({
  type: PLAYBACK_LOADED,
  meta,
  durationMs,
  markers,
  statusTimeline,
  density,
});

export const playPlayback = (): PlaybackPlayAction => ({ type: PLAYBACK_PLAY });

export const pausePlayback = (): PlaybackPauseAction => ({
  type: PLAYBACK_PAUSE,
});

export const seekPlayback = (t: number): PlaybackSeekAction => ({
  type: PLAYBACK_SEEK,
  t,
});

export const tickPlayback = (cursorMs: number): PlaybackTickAction => ({
  type: PLAYBACK_TICK,
  cursorMs,
});

export const setPlaybackSpeed = (speed: number): PlaybackSetSpeedAction => ({
  type: PLAYBACK_SET_SPEED,
  speed,
});

export const setPlaybackMode = (mode: PlaybackMode): PlaybackSetModeAction => ({
  type: PLAYBACK_SET_MODE,
  mode,
});

export const setGhostOpacity = (opacity: number): PlaybackSetOpacityAction => ({
  type: PLAYBACK_SET_OPACITY,
  opacity,
});

export const setPlaybackLoop = (loop: boolean): PlaybackSetLoopAction => ({
  type: PLAYBACK_SET_LOOP,
  loop,
});

export const exitPlayback = (): PlaybackExitAction => ({ type: PLAYBACK_EXIT });

export const setAlign = (
  align: Partial<AlignState>,
): PlaybackSetAlignAction => ({
  type: PLAYBACK_SET_ALIGN,
  align,
});

export const setPlaybackError = (
  message: string | null,
): PlaybackErrorAction => ({
  type: PLAYBACK_ERROR,
  message,
});

/** Tells every telemetry-derived view to discard what it has accumulated. */
export const resetTelemetryFold = (): PlaybackResetFoldAction => ({
  type: PLAYBACK_RESET_FOLD,
});

/**
 * The recording contained a clear. Resets the telemetry key fold, and nothing
 * else -- see PlaybackState.clearToken.
 */
export const recordedClear = () => ({
  type: PLAYBACK_RECORDED_CLEAR as typeof PLAYBACK_RECORDED_CLEAR,
});

export const setRecorderState = (
  recorder: Partial<RecorderState>,
): RecorderStateAction => ({
  type: RECORDER_STATE,
  recorder,
});

export const setRecorderEnabled = (
  enabled: boolean,
): RecorderSetEnabledAction => ({
  type: RECORDER_SET_ENABLED,
  enabled,
});

export const startRecording = (): RecorderStartAction => ({
  type: RECORDER_START,
});

export const stopRecording = (): RecorderStopAction => ({
  type: RECORDER_STOP,
});
