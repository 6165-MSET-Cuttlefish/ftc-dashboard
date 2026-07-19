import {
  StartLogRecordingAction,
  StopLogRecordingAction,
  ClearLogRecordingAction,
  SetMaxLogEntriesAction,
  START_LOG_RECORDING,
  STOP_LOG_RECORDING,
  CLEAR_LOG_RECORDING,
  SET_MAX_LOG_ENTRIES,
} from '../types/logRecorder';

export const startLogRecording = (): StartLogRecordingAction => ({
  type: START_LOG_RECORDING,
});

export const stopLogRecording = (): StopLogRecordingAction => ({
  type: STOP_LOG_RECORDING,
});

export const clearLogRecording = (): ClearLogRecordingAction => ({
  type: CLEAR_LOG_RECORDING,
});

export const setMaxLogEntries = (
  maxEntries: number,
): SetMaxLogEntriesAction => ({
  type: SET_MAX_LOG_ENTRIES,
  maxEntries,
});
