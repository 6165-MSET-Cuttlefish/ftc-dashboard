import type { DrawOp } from '@/store/types/telemetry';

export const SET_REPLAY_OVERLAY = 'SET_REPLAY_OVERLAY';

/** One frame of a recording shown alongside the live robot. `data` is what lets
 *  the Graph plot recorded series, rather than the overlay being field-only. */
export type SetReplayOverlayAction = {
  type: typeof SET_REPLAY_OVERLAY;
  overlay: DrawOp[];
  data?: { [key: string]: string };
};

export type ReplayAction = SetReplayOverlayAction;
