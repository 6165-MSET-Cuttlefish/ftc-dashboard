import React, { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';

import OpModeStatus from '@/enums/OpModeStatus';
import type { Marker, StatusSample } from '@/store/recording/format';
import { formatClock, formatClockShort } from '@/store/recording/timeFormat';
import { MUTED_TEXT, SMALL_BUTTON } from './controlStyles';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const MAX_TICKS = 6;

type TransportBarProps = {
  cursorMs: number;
  durationMs: number;
  isPlaying: boolean;
  speed: number;
  loop: boolean;
  markers: Marker[];
  statusTimeline: StatusSample[];
  density: number[];
  onSeek: (t: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onSetSpeed: (speed: number) => void;
  onSetLoop: (loop: boolean) => void;
  onStep: (deltaMs: number) => void;
  /**
   * Compare mode, where the cursor tracks the live run rather than the Play
   * button. Speed and loop are meaningless there: the recording is pinned to
   * real time, and a second lap would draw an auto ghost over a teleop robot.
   */
  followsLive?: boolean;
};

function pct(t: number, durationMs: number) {
  if (durationMs <= 0) return 0;
  return Math.max(0, Math.min(100, (t / durationMs) * 100));
}

/**
 * Ruler tick positions at a round interval.
 *
 * Hard-bounded rather than derived from the duration alone: an imported
 * recording can carry a non-finite one, and the loop then pins the main thread.
 */
function rulerTicks(durationMs: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [0];

  const candidates = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000];
  const interval =
    candidates.find((c) => durationMs / c <= MAX_TICKS) ??
    Math.ceil(durationMs / MAX_TICKS);

  const ticks: number[] = [];
  for (
    let t = 0;
    t <= durationMs && ticks.length < MAX_TICKS + 1;
    t += interval
  ) {
    ticks.push(t);
  }
  return ticks;
}

/** The scrub track: op mode state, notable events and activity, drawn inside
 *  it rather than stacked above as separate unlabelled strips. */
const Track = ({
  cursorMs,
  durationMs,
  markers,
  statusTimeline,
  density,
  onSeek,
}: {
  cursorMs: number;
  durationMs: number;
  markers: Marker[];
  statusTimeline: StatusSample[];
  density: number[];
  onSeek: (t: number) => void;
}) => {
  // One span per RUN of identical status, not per sample. The recorder samples
  // once a second, so a ten-minute match is 600 absolutely positioned nodes
  // reconciled on every cursor tick, all but a handful of them the same colour
  // butted against each other. Collapsing them is also the honest rendering:
  // the boundaries are where the op mode actually changed state.
  const spans = useMemo(() => {
    const runs: {
      left: number;
      width: number;
      state: string | undefined;
      lowBattery: number | null;
      highBattery: number | null;
      t: number;
      end: number;
    }[] = [];

    statusTimeline.forEach(([t, status], i) => {
      const end = statusTimeline[i + 1]?.[0] ?? durationMs;
      const volts =
        typeof status.batteryVoltage === 'number' && status.batteryVoltage > 0
          ? status.batteryVoltage
          : null;
      const open = runs[runs.length - 1];

      if (open && open.state === status.activeOpModeStatus) {
        // Voltage sag across a run is the thing worth reading, so the tooltip
        // keeps the range rather than whichever sample opened the span.
        open.end = end;
        open.width = pct(end - open.t, durationMs);
        if (volts !== null) {
          open.lowBattery =
            open.lowBattery === null ? volts : Math.min(open.lowBattery, volts);
          open.highBattery =
            open.highBattery === null
              ? volts
              : Math.max(open.highBattery, volts);
        }
        return;
      }

      runs.push({
        left: pct(t, durationMs),
        width: pct(end - t, durationMs),
        state: status.activeOpModeStatus,
        lowBattery: volts,
        highBattery: volts,
        t,
        end,
      });
    });

    return runs;
  }, [statusTimeline, durationMs]);

  const peak = Math.max(1, ...density);

  return (
    <div className="relative h-9">
      {/* Activity, as the track's own backdrop. */}
      <div
        className="absolute inset-x-0 top-0 flex h-9 items-end gap-px overflow-hidden rounded bg-gray-100 dark:bg-slate-800"
        title="Bar height is how much data arrived"
      >
        {density.map((d, i) => (
          <div
            key={i}
            className="flex-1 bg-gray-200 dark:bg-slate-700"
            style={{ height: `${Math.max(6, (d / peak) * 100)}%` }}
          />
        ))}
      </div>

      {/* Op mode state along the top edge. z-10 for the same reason as the
          markers: its title is the only place the battery voltage at a moment
          is readable. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 overflow-hidden rounded-t">
        {spans.map((s, i) => (
          <div
            key={i}
            className={clsx(
              'pointer-events-auto absolute top-0 h-full',
              s.state === OpModeStatus.RUNNING && 'bg-primary-500',
              s.state === OpModeStatus.INIT && 'bg-amber-400',
              s.state === OpModeStatus.STOPPED &&
                'bg-gray-400 dark:bg-slate-500',
            )}
            style={{ left: `${s.left}%`, width: `${Math.max(s.width, 0.4)}%` }}
            title={`${formatClock(s.t)} ${s.state ?? ''}${batteryLabel(s)}`}
          />
        ))}
      </div>

      {/* Played portion. */}
      <div
        className="pointer-events-none absolute top-0 h-9 rounded-l bg-primary-500/20"
        style={{ width: `${pct(cursorMs, durationMs)}%` }}
      />
      <div
        className="pointer-events-none absolute top-0 h-9 w-0.5 bg-primary-600 dark:bg-primary-400"
        style={{ left: `${pct(cursorMs, durationMs)}%` }}
      />

      {/* Anything worth jumping to. Explicitly above the scrub surface and
          swallowing its own pointerdown, so clicking a marker jumps to that
          marker instead of scrubbing to wherever the pixel happened to be. The
          title is the only place a marker's text is rendered anywhere in the
          app, so losing the hit test also lost the label. */}
      {markers.map((m, i) => (
        <button
          key={i}
          className={clsx(
            'absolute bottom-0 z-10 h-2 w-1 -translate-x-1/2 rounded-sm',
            m.kind === 'error' ? 'bg-red-500' : 'bg-gray-400 dark:bg-slate-400',
          )}
          style={{ left: `${pct(m.t, durationMs)}%` }}
          title={`${formatClock(m.t)}  ${m.text}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onSeek(m.t)}
        />
      ))}
    </div>
  );
};

/** "at 12.40V", or "12.40V down to 11.85V" when it sagged across the span. */
function batteryLabel(span: {
  lowBattery: number | null;
  highBattery: number | null;
}): string {
  const { lowBattery, highBattery } = span;
  if (lowBattery === null || highBattery === null) return '';
  if (Math.abs(highBattery - lowBattery) < 0.05) {
    return ` at ${highBattery.toFixed(2)}V`;
  }
  return ` at ${highBattery.toFixed(2)}V down to ${lowBattery.toFixed(2)}V`;
}

const Swatch = ({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) => (
  <span className="flex items-center gap-1">
    <span className={clsx('inline-block h-2 w-2 rounded-sm', className)} />
    {children}
  </span>
);

const TransportBar = ({
  cursorMs,
  durationMs,
  isPlaying,
  speed,
  loop,
  markers,
  statusTimeline,
  density,
  onSeek,
  onPlay,
  onPause,
  onSetSpeed,
  onSetLoop,
  onStep,
  followsLive = false,
}: TransportBarProps) => {
  const ticks = useMemo(() => rulerTicks(durationMs), [durationMs]);

  // The cursor tick rewrites a controlled input while playing, so the thumb
  // slides out from under a stationary finger; local state owns the value for
  // the drag. Latched on pointer-down, not on change: a non-drag change (arrow
  // keys, a programmatic set) gets no pointer-up and would freeze the readout.
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const shownMs = dragMs ?? cursorMs;
  const endDrag = () => {
    dragging.current = false;
    setDragMs(null);
  };

  // Where a pointer at this x lands in the recording. Linear across the full
  // track width, the same mapping the playhead, markers, status spans and ruler
  // labels are drawn with -- a native range input insets the thumb by half its
  // width, so pointer and playhead would agree only at the midpoint and ends.
  const msAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return null;

    const r = el.getBoundingClientRect();
    if (r.width <= 0) return null;

    // No duration means the recording has not finished decoding. Returning 0
    // here looked like a deliberate seek to the start, so grabbing the scrubber
    // while a large file was still loading silently threw the cursor back to
    // zero instead of doing nothing.
    if (!(durationMs > 0)) return null;

    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return frac * durationMs;
  };

  const step = (deltaMs: number) =>
    onSeek(Math.max(0, Math.min(durationMs, cursorMs + deltaMs)));

  return (
    <div>
      <div
        ref={trackRef}
        className="relative cursor-pointer"
        role="slider"
        tabIndex={0}
        aria-label="Position in recording"
        aria-valuemin={0}
        aria-valuemax={Math.max(durationMs, 0)}
        aria-valuenow={Math.round(shownMs)}
        aria-valuetext={formatClock(shownMs)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;

          const t = msAt(e.clientX);
          if (t === null) return;

          dragging.current = true;
          setDragMs(t);
          onSeek(t);

          // Capture is an optimisation: it keeps the drag alive when the pointer
          // leaves the track. It throws if that pointer is already gone, which a
          // synthetic event or a fast tap can both produce, and an uncaught
          // throw here would take the seek down with it.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // onPointerUp on the element still ends the drag.
          }
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;

          const t = msAt(e.clientX);
          if (t === null) return;

          setDragMs(t);
          onSeek(t);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={(e) => {
          // Only when the track itself has focus. The marker buttons are its
          // children, so a Space on a focused marker bubbled up here and was
          // preventDefault()'d before the button could activate: the markers
          // were reachable by keyboard but not usable by it.
          if (e.target !== e.currentTarget) return;

          const d = e.shiftKey ? 1000 : 100;
          switch (e.key) {
            case ' ':
              // The track takes focus on click, and the tile's own shortcuts
              // only fire when the tile itself is the target, so without this
              // the space bar stops working the moment you touch the scrubber.
              e.preventDefault();
              if (isPlaying) onPause();
              else onPlay();
              break;
            case 'ArrowLeft':
              e.preventDefault();
              step(-d);
              break;
            case 'ArrowRight':
              e.preventDefault();
              step(d);
              break;
            case 'Home':
              e.preventDefault();
              onSeek(0);
              break;
            case 'End':
              e.preventDefault();
              onSeek(durationMs);
              break;
            default:
              break;
          }
        }}
      >
        <Track
          cursorMs={shownMs}
          durationMs={durationMs}
          markers={markers}
          statusTimeline={statusTimeline}
          density={density}
          onSeek={onSeek}
        />
      </div>

      {/* Absolutely positioned, not justify-between: ticks land on round times
          that do not divide the duration evenly, so even spacing would put the
          last label at 100% and mislabel every position before it. */}
      <div className="relative mt-0.5 h-4 text-xs text-gray-500 dark:text-slate-400">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${pct(t, durationMs)}%` }}
          >
            {formatClockShort(t)}
          </span>
        ))}
      </div>

      {/* The track packs three encodings into 36 pixels and none of them are
          self-explanatory, so name them once underneath. */}
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${MUTED_TEXT}`}
      >
        {statusTimeline.length > 0 && (
          <>
            <Swatch className="bg-amber-400">Init</Swatch>
            <Swatch className="bg-primary-500">Running</Swatch>
            <Swatch className="bg-gray-400 dark:bg-slate-500">Stopped</Swatch>
          </>
        )}
        {markers.length > 0 && (
          <Swatch className="bg-red-500">Event, click to jump</Swatch>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          className="w-20 rounded bg-primary-600 py-1 text-sm font-medium text-white transition hover:bg-primary-700"
          onClick={isPlaying ? onPause : onPlay}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          className={SMALL_BUTTON}
          onClick={() => onStep(-1000)}
          title="Back one second"
        >
          -1s
        </button>
        <button
          className={SMALL_BUTTON}
          onClick={() => onStep(1000)}
          title="Forward one second"
        >
          +1s
        </button>

        <span className="font-mono text-sm tabular-nums">
          {formatClock(shownMs)}
          <span className="text-gray-500 dark:text-slate-400">
            {' / '}
            {formatClock(durationMs)}
          </span>
        </span>

        <span className="ml-auto flex items-center gap-2 text-xs">
          {followsLive ? (
            <span className="text-gray-500 dark:text-slate-400">
              Following the live run
            </span>
          ) : (
            <>
              <label className="flex items-center gap-1">
                <span className="text-gray-500 dark:text-slate-400">Speed</span>
                <select
                  className="rounded border-gray-300 py-0.5 pl-1 pr-6 text-xs dark:border-slate-600 dark:bg-slate-800"
                  value={speed}
                  onChange={(e) => onSetSpeed(Number(e.target.value))}
                >
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}x
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="rounded text-primary-600"
                  checked={loop}
                  onChange={(e) => onSetLoop(e.target.checked)}
                />
                Loop
              </label>
            </>
          )}
        </span>
      </div>
    </div>
  );
};

export default TransportBar;
