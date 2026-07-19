import { LogcatError } from './logcat';

export const START_LOG_RECORDING = 'START_LOG_RECORDING';
export const STOP_LOG_RECORDING = 'STOP_LOG_RECORDING';
export const CLEAR_LOG_RECORDING = 'CLEAR_LOG_RECORDING';
export const SET_MAX_LOG_ENTRIES = 'SET_MAX_LOG_ENTRIES';

// Guards against unbounded memory growth if a recording is left running;
// the oldest entries are dropped once the cap is reached. The cap is
// user-adjustable in Settings within these bounds.
export const DEFAULT_MAX_RECORDED_ENTRIES = 10000;
export const MIN_MAX_RECORDED_ENTRIES = 100;
export const MAX_MAX_RECORDED_ENTRIES = 100000;

export const MAX_LOG_ENTRIES_STORAGE_KEY = 'maxRecordedLogEntries';

export interface LogRecorderState {
  isRecording: boolean;
  startTime: number | null;
  stopTime: number | null;
  entries: LogcatError[];
  truncated: boolean;
  maxEntries: number;
}

export interface StartLogRecordingAction {
  type: typeof START_LOG_RECORDING;
}

export interface StopLogRecordingAction {
  type: typeof STOP_LOG_RECORDING;
}

export interface ClearLogRecordingAction {
  type: typeof CLEAR_LOG_RECORDING;
}

export interface SetMaxLogEntriesAction {
  type: typeof SET_MAX_LOG_ENTRIES;
  maxEntries: number;
}

export type LogRecorderAction =
  | StartLogRecordingAction
  | StopLogRecordingAction
  | ClearLogRecordingAction
  | SetMaxLogEntriesAction;
