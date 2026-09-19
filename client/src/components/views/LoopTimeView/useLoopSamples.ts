import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { RootState } from '@/store/reducers';

export type LoopSample = {
  timestamp: number;
  /** Every numeric telemetry value in the packet, still in its source unit. */
  values: Record<string, number>;
};

export const DEFAULT_MAX_SAMPLES = 300;

function numericValues(data: Record<string, string>): Record<string, number> {
  const values: Record<string, number> = {};

  for (const key of Object.keys(data)) {
    const parsed = parseFloat(data[key]);
    if (Number.isFinite(parsed)) values[key] = parsed;
  }

  return values;
}

/**
 * Accumulates a rolling window of numeric telemetry.
 *
 * The telemetry slice is replaced wholesale with each batch the robot sends,
 * so history has to be built up here. Packets are deduped by timestamp, and a
 * timestamp moving backwards is treated as a fresh op mode run.
 */
export default function useLoopSamples(
  maxSamples: number = DEFAULT_MAX_SAMPLES,
  paused = false,
): {
  samples: LoopSample[];
  availableKeys: string[];
  reset: () => void;
} {
  const packets = useSelector((state: RootState) => state.telemetry);

  const [samples, setSamples] = useState<LoopSample[]>([]);
  const [availableKeys, setAvailableKeys] = useState<string[]>([]);

  const lastTimestamp = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const reset = useCallback(() => {
    lastTimestamp.current = 0;
    setSamples([]);
    setAvailableKeys([]);
  }, []);

  useEffect(() => {
    if (pausedRef.current) return;
    if (packets.length === 0) return;

    const newest = packets[packets.length - 1].timestamp;
    // A restarted op mode rewinds the clock; drop the stale window.
    if (newest < lastTimestamp.current) {
      lastTimestamp.current = 0;
      setSamples([]);
    }

    const fresh = packets
      .filter((packet) => packet.timestamp > lastTimestamp.current)
      .map((packet) => ({
        timestamp: packet.timestamp,
        values: numericValues(packet.data),
      }));

    if (fresh.length === 0) return;

    lastTimestamp.current = fresh[fresh.length - 1].timestamp;

    setSamples((prev) => [...prev, ...fresh].slice(-maxSamples));
    setAvailableKeys((prev) => {
      const seen = new Set(prev);
      let changed = false;

      for (const sample of fresh) {
        for (const key of Object.keys(sample.values)) {
          if (seen.has(key)) continue;
          seen.add(key);
          changed = true;
        }
      }

      return changed ? [...seen].sort() : prev;
    });
  }, [packets, maxSamples]);

  return { samples, availableKeys, reset };
}
