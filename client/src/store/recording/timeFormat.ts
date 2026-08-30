/** Clamped rather than propagated: the failure mode is a clock reading
 *  "NaN:NaN.NaN" in the middle of a match. */
function safeMs(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms));
}

/** m:ss.d */
export function formatClock(ms: number): string {
  const safe = safeMs(ms);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const tenths = Math.floor((safe % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/** m:ss, for ruler labels. */
export function formatClockShort(ms: number): string {
  const safe = safeMs(ms);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;

  // Bounded as well as rounded: `(1048064 / 1024).toFixed(0)` is "1024", so the
  // counter would read 1023 KB, 1024 KB, 1.0 MB.
  const kb = bytes / 1024;
  if (kb < 1023.5) return `${kb.toFixed(0)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
