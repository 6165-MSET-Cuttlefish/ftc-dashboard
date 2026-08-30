import type {
  Marker,
  RecordingMeta,
  StatusSample,
} from '@/store/recording/format';

export const PLAYBACK_LOAD = 'PLAYBACK_LOAD';
export const PLAYBACK_LOADED = 'PLAYBACK_LOADED';
export const PLAYBACK_PLAY = 'PLAYBACK_PLAY';
export const PLAYBACK_PAUSE = 'PLAYBACK_PAUSE';
export const PLAYBACK_SEEK = 'PLAYBACK_SEEK';
export const PLAYBACK_TICK = 'PLAYBACK_TICK';
export const PLAYBACK_SET_SPEED = 'PLAYBACK_SET_SPEED';
export const PLAYBACK_SET_MODE = 'PLAYBACK_SET_MODE';
export const PLAYBACK_SET_OPACITY = 'PLAYBACK_SET_OPACITY';
export const PLAYBACK_SET_LOOP = 'PLAYBACK_SET_LOOP';
export const PLAYBACK_EXIT = 'PLAYBACK_EXIT';
export const PLAYBACK_SET_ALIGN = 'PLAYBACK_SET_ALIGN';
export const PLAYBACK_ERROR = 'PLAYBACK_ERROR';
export const PLAYBACK_RESET_FOLD = 'PLAYBACK_RESET_FOLD';
export const PLAYBACK_RECORDED_CLEAR = 'PLAYBACK_RECORDED_CLEAR';
export const RECORDER_STATE = 'RECORDER_STATE';
export const RECORDER_SET_ENABLED = 'RECORDER_SET_ENABLED';
export const RECORDER_START = 'RECORDER_START';
export const RECORDER_STOP = 'RECORDER_STOP';

/** `ghost` blends a recording's field ops over live data; `playback` gates live
 *  telemetry and drives every telemetry-derived view from the recording. */
export type PlaybackMode = 'live' | 'ghost' | 'playback';

/** How the recording's clock is tied to the live run's. Without it the playhead
 *  anchors to whenever Play was pressed, and the traces mean nothing. */
export type AlignState = {
  /** Recording-relative ms of the recorded op mode start, once known. */
  recAnchorMs: number | null;
  /** A sharper start than the 1 Hz status track: the robot telemeters within a
   *  frame of START. Null when no such frame sits just before the edge. */
  recSnapMs: number | null;
  /** Date.now() of the live op mode start, once observed. */
  liveAnchorWall: number | null;
  /** Where recAnchorMs came from, which sets how much to trust it. */
  source: 'start' | 'first-data' | 'none';
  /**
   * 'aligned'   the ghost is following the live run
   * 'waiting'   no live run yet; it will line itself up when one starts
   * 'unaligned' joined mid-match, or the recording has no start to key on
   * 'manual'    the user moved the playhead, so it is no longer following
   */
  status: 'aligned' | 'waiting' | 'unaligned' | 'manual';
};

export type RecorderState = {
  enabled: boolean;
  active: boolean;
  frames: number;
  bytes: number;
  /** Not the encoder's durationMs, which is the max across three tracks on
   *  different clocks and so jumps around instead of counting up. */
  elapsedMs: number;
  /** Span of the recording itself, as it will be saved. */
  durationMs: number;
  id: string | null;
};

export type PlaybackState = {
  mode: PlaybackMode;
  isPlaying: boolean;
  /** Bumped when the engine invalidates the telemetry sink. Scoped to it: ghost
   *  drives only the overlay, so advancing there would wipe a live capture. */
  foldToken: number;
  /** A clear inside the RECORDING, not the engine discarding what is on screen.
   *  Only the telemetry fold reads it; Logging and the Graph key on foldToken. */
  clearToken: number;
  recordingId: string | null;
  meta: RecordingMeta | null;
  cursorMs: number;
  durationMs: number;
  speed: number;
  loop: boolean;
  ghostOpacity: number;
  markers: Marker[];
  statusTimeline: StatusSample[];
  /** Encoded bytes per time bucket, for the transport bar's activity sparkline. */
  density: number[];
  recorder: RecorderState;
  align: AlignState;
  error: string | null;
};

export type PlaybackLoadAction = {
  type: typeof PLAYBACK_LOAD;
  id: string;
};

export type PlaybackLoadedAction = {
  type: typeof PLAYBACK_LOADED;
  meta: RecordingMeta;
  durationMs: number;
  markers: Marker[];
  statusTimeline: StatusSample[];
  density: number[];
};

export type PlaybackPlayAction = { type: typeof PLAYBACK_PLAY };
export type PlaybackPauseAction = { type: typeof PLAYBACK_PAUSE };
export type PlaybackSeekAction = { type: typeof PLAYBACK_SEEK; t: number };
export type PlaybackTickAction = {
  type: typeof PLAYBACK_TICK;
  cursorMs: number;
};
export type PlaybackSetSpeedAction = {
  type: typeof PLAYBACK_SET_SPEED;
  speed: number;
};
export type PlaybackSetModeAction = {
  type: typeof PLAYBACK_SET_MODE;
  mode: PlaybackMode;
};
export type PlaybackSetOpacityAction = {
  type: typeof PLAYBACK_SET_OPACITY;
  opacity: number;
};
export type PlaybackSetLoopAction = {
  type: typeof PLAYBACK_SET_LOOP;
  loop: boolean;
};
export type PlaybackExitAction = { type: typeof PLAYBACK_EXIT };
export type PlaybackSetAlignAction = {
  type: typeof PLAYBACK_SET_ALIGN;
  align: Partial<AlignState>;
};
export type PlaybackErrorAction = {
  type: typeof PLAYBACK_ERROR;
  message: string | null;
};
export type PlaybackResetFoldAction = { type: typeof PLAYBACK_RESET_FOLD };
export type PlaybackRecordedClearAction = {
  type: typeof PLAYBACK_RECORDED_CLEAR;
};
export type RecorderStateAction = {
  type: typeof RECORDER_STATE;
  recorder: Partial<RecorderState>;
};
export type RecorderSetEnabledAction = {
  type: typeof RECORDER_SET_ENABLED;
  enabled: boolean;
};
export type RecorderStartAction = { type: typeof RECORDER_START };
export type RecorderStopAction = { type: typeof RECORDER_STOP };

export type PlaybackAction =
  | PlaybackLoadAction
  | PlaybackLoadedAction
  | PlaybackPlayAction
  | PlaybackPauseAction
  | PlaybackSeekAction
  | PlaybackTickAction
  | PlaybackSetSpeedAction
  | PlaybackSetModeAction
  | PlaybackSetOpacityAction
  | PlaybackSetLoopAction
  | PlaybackExitAction
  | PlaybackSetAlignAction
  | PlaybackErrorAction
  | PlaybackResetFoldAction
  | PlaybackRecordedClearAction
  | RecorderStateAction
  | RecorderSetEnabledAction
  | RecorderStartAction
  | RecorderStopAction;
