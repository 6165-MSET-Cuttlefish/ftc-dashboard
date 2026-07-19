import {
  LogRecorderState,
  START_LOG_RECORDING,
  STOP_LOG_RECORDING,
  CLEAR_LOG_RECORDING,
  SET_MAX_LOG_ENTRIES,
  DEFAULT_MAX_RECORDED_ENTRIES,
  MIN_MAX_RECORDED_ENTRIES,
  MAX_MAX_RECORDED_ENTRIES,
  MAX_LOG_ENTRIES_STORAGE_KEY,
} from '../types/logRecorder';
import { RECEIVE_LOGCAT_ERRORS } from '../types/logcat';

const clampMaxEntries = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_RECORDED_ENTRIES;
  }
  return Math.min(
    MAX_MAX_RECORDED_ENTRIES,
    Math.max(MIN_MAX_RECORDED_ENTRIES, Math.round(value)),
  );
};

const loadMaxEntries = (): number => {
  const stored = parseInt(
    localStorage.getItem(MAX_LOG_ENTRIES_STORAGE_KEY) ?? '',
    10,
  );
  return isNaN(stored) ? DEFAULT_MAX_RECORDED_ENTRIES : clampMaxEntries(stored);
};

const initialState: LogRecorderState = {
  isRecording: false,
  startTime: null,
  stopTime: null,
  entries: [],
  truncated: false,
  maxEntries: loadMaxEntries(),
};

const logRecorderReducer = (
  state = initialState,
  action: any,
): LogRecorderState => {
  switch (action.type) {
    case START_LOG_RECORDING:
      return {
        ...state,
        isRecording: true,
        startTime: Date.now(),
        stopTime: null,
        entries: [],
        truncated: false,
      };
    case STOP_LOG_RECORDING:
      if (!state.isRecording) {
        return state;
      }
      return {
        ...state,
        isRecording: false,
        stopTime: Date.now(),
      };
    case CLEAR_LOG_RECORDING:
      return {
        ...state,
        isRecording: false,
        startTime: null,
        stopTime: null,
        entries: [],
        truncated: false,
      };
    case SET_MAX_LOG_ENTRIES: {
      const maxEntries = clampMaxEntries(action.maxEntries);
      localStorage.setItem(MAX_LOG_ENTRIES_STORAGE_KEY, String(maxEntries));
      return {
        ...state,
        maxEntries,
        entries: state.entries.slice(-maxEntries),
        truncated: state.truncated || state.entries.length > maxEntries,
      };
    }
    case RECEIVE_LOGCAT_ERRORS: {
      if (!state.isRecording) {
        return state;
      }
      const newEntries = Array.isArray(action.errors) ? action.errors : [];
      if (newEntries.length === 0) {
        return state;
      }
      const combined = [...state.entries, ...newEntries];
      return {
        ...state,
        entries: combined.slice(-state.maxEntries),
        truncated: state.truncated || combined.length > state.maxEntries,
      };
    }
    default:
      return state;
  }
};

export default logRecorderReducer;
