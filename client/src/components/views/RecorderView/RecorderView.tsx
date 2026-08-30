import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';

import BaseView, {
  BaseViewBody,
  BaseViewHeading,
  BaseViewHeadingProps,
  BaseViewProps,
} from '@/components/views/BaseView';
import {
  exitPlayback,
  loadRecording,
  pausePlayback,
  playPlayback,
  seekPlayback,
  setGhostOpacity,
  setPlaybackError,
  setPlaybackLoop,
  setPlaybackMode,
  setPlaybackSpeed,
  setRecorderEnabled,
  startRecording,
  stopRecording,
} from '@/store/actions/playback';
import {
  exportFile,
  importFile,
  isIndexedDbAvailable,
  list,
  RecordingListEntry,
  remove,
  updateMeta,
  usage,
} from '@/store/recording/recordingStore';
import { formatBytes, formatClock } from '@/store/recording/timeFormat';
import { RootState } from '@/store/reducers';

import RecordingLibrary from './RecordingLibrary';
import TransportBar from './TransportBar';
import { SMALL_BUTTON, SMALL_BUTTON_FIXED } from './controlStyles';

type RecorderViewProps = BaseViewProps & BaseViewHeadingProps;

/** The engine's `ghost` and `playback` modes. Its third, `live`, is not a
 *  choice here: it is having no recording open, which Close gets you back to. */
/** A hoverable dot, for the sentence that explains a label rather than being one. */
const HelpMark = () => (
  <span
    className={
      'ml-1 inline-flex h-3.5 w-3.5 cursor-help select-none items-center ' +
      'justify-center rounded-full border align-[-0.1em] text-[9px] ' +
      'border-gray-400 font-bold leading-none text-gray-500 ' +
      'dark:border-slate-500 dark:text-slate-400'
    }
    aria-hidden
  >
    ?
  </span>
);

/**
 * What compare mode is currently doing, as a short line plus the reason behind
 * it. Alignment is the whole claim of this mode, so the state itself stays on
 * screen; only the explanation moves to the tooltip.
 */
function alignState(playback: RootState['playback']): {
  label: string;
  detail: string;
} {
  if (playback.durationMs > 0 && playback.cursorMs >= playback.durationMs) {
    return {
      label: 'Recording has run out',
      detail:
        'The live robot is still going; the recorded path stays on screen.',
    };
  }

  switch (playback.align.status) {
    case 'manual':
      return {
        label: 'Not following the robot',
        detail:
          'You moved the playhead. Press Play to line it up with the live run again.',
      };
    case 'unaligned':
      return {
        label: 'Cannot line up automatically',
        detail:
          'You joined after this run started, so there is no shared start to key on.',
      };
    case 'waiting':
      return {
        label: 'Waiting for the op mode to start',
        detail: 'This will line itself up as soon as a run begins.',
      };
    default:
      break;
  }

  if (playback.align.source === 'start') {
    return {
      label: 'Lined up on op mode start',
      detail:
        'Robot status is polled once a second, so this can be up to a second out.',
    };
  }
  if (playback.align.source === 'first-data') {
    return {
      label: 'Lined up on first data',
      detail: 'This recording has no op mode start in it to key on.',
    };
  }
  return {
    label: 'Lined up on the start of the recording',
    detail: 'Neither an op mode start nor any earlier data to key on.',
  };
}

const VIEW_OPTIONS = [
  {
    mode: 'playback' as const,
    label: 'Play it back',
    hint: 'Field, Graph, Telemetry and Logging all show the recording. Live data is paused until you close it.',
  },
  {
    mode: 'ghost' as const,
    label: 'Compare with live',
    hint: 'Lines this recording up with the live run and draws it over the Field and Graph, so you can see where the two diverge. Telemetry and Logging stay live.',
  },
];

const RecorderView = ({
  isDraggable = false,
  isUnlocked = false,
}: RecorderViewProps) => {
  const dispatch = useDispatch();
  const playback = useSelector((state: RootState) => state.playback);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<RecordingListEntry[]>([]);
  /**
   * A file is being dragged over the panel.
   *
   * Counted rather than boolean: dragenter and dragleave both fire when the
   * pointer crosses between children, so a flag flickers off mid-drag.
   */
  const [dragDepth, setDragDepth] = useState(0);
  const [storage, setStorage] = useState({ usage: 0, quota: 0 });

  const refresh = useCallback(async () => {
    setEntries(await list());
    setStorage(await usage());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A finished recording only appears in the library once it has been written,
  // so re-list on the active-to-idle edge.
  const wasRecording = useRef(false);
  useEffect(() => {
    const justStopped = wasRecording.current && !playback.recorder.active;
    wasRecording.current = playback.recorder.active;

    if (!justStopped) return;

    // The final flush is async, so give it a beat before re-listing.
    const timeout = setTimeout(() => void refresh(), 500);
    return () => clearTimeout(timeout);
  }, [playback.recorder.active, refresh]);

  const isOpen = playback.recordingId !== null;
  const isPlaybackMode = playback.mode === 'playback';

  const handleSeek = useCallback(
    (t: number) => dispatch(seekPlayback(t)),
    [dispatch],
  );

  const handleStep = useCallback(
    (deltaMs: number) => dispatch(seekPlayback(playback.cursorMs + deltaMs)),
    [dispatch, playback.cursorMs],
  );

  const handleKeyDown = useCallback(
    (evt: React.KeyboardEvent) => {
      if (!isOpen) return;
      // Only act when the tile itself has focus. Otherwise Space on a focused
      // button inside the view gets preventDefault()'d here and never activates
      // the button.
      if (evt.target !== evt.currentTarget) return;

      const step = evt.shiftKey ? 1000 : 100;
      switch (evt.key) {
        case ' ':
          evt.preventDefault();
          dispatch(playback.isPlaying ? pausePlayback() : playPlayback());
          break;
        case 'ArrowLeft':
          evt.preventDefault();
          handleStep(-step);
          break;
        case 'ArrowRight':
          evt.preventDefault();
          handleStep(step);
          break;
        case 'Home':
          handleSeek(0);
          break;
        case 'End':
          handleSeek(playback.durationMs);
          break;
        default:
          break;
      }
    },
    [
      dispatch,
      handleSeek,
      handleStep,
      isOpen,
      playback.durationMs,
      playback.isPlaying,
    ],
  );

  const reportError = useCallback(
    (what: string) => (err: unknown) => {
      dispatch(
        setPlaybackError(
          `${what}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    },
    [dispatch],
  );

  // Stable identities so RecordingLibrary's memo actually holds while the cursor
  // ticks at 10 Hz.
  const handleSelect = useCallback(
    (id: string) => dispatch(loadRecording(id)),
    [dispatch],
  );

  const handleDelete = useCallback(
    (id: string) => {
      void (async () => {
        if (id === playback.recordingId) dispatch(exitPlayback());
        await remove(id);
        await refresh();
      })().catch(reportError('Could not delete that recording'));
    },
    [dispatch, playback.recordingId, refresh, reportError],
  );

  const handleRename = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed === '') return;

      void (async () => {
        // Renaming is the signal that a run is worth keeping, so it also pins it.
        await updateMeta(id, { name: trimmed, pinned: true });
        await refresh();
      })().catch(reportError('Could not rename that recording'));
    },
    [refresh, reportError],
  );

  const handleExport = useCallback(
    (id: string) => {
      void exportFile(id)
        .then(refresh)
        .catch(reportError('Could not export that recording'));
    },
    [refresh, reportError],
  );

  const handleImport = async (files: FileList | null) => {
    if (!files) return;

    for (const file of Array.from(files)) {
      try {
        await importFile(file);
      } catch (err) {
        dispatch(
          setPlaybackError(
            `Could not import ${file.name}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      }
    }
    await refresh();
  };

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return (
    <BaseView
      // The drop hint is absolutely positioned inside this panel, and BaseView
      // is not itself a positioning context.
      className="relative"
      isUnlocked={isUnlocked}
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      // Dropping a file is the natural way to open a recording someone sent
      // you, and unlike the file picker it is something the panel can actually
      // show: the drop target is this panel, so it can say so.
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        // Without this the browser navigates to the file instead.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragDepth(0);
        void handleImport(e.dataTransfer.files);
      }}
    >
      {dragDepth > 0 && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-primary-500 bg-primary-500/10">
          <p className="rounded bg-primary-600 px-3 py-1 text-sm font-medium text-white">
            Drop to import
          </p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <BaseViewHeading isDraggable={isDraggable}>Recorder</BaseViewHeading>
        {playback.recorder.active && (
          <span className="mr-4 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium text-red-600 dark:text-red-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Recording {formatClock(playback.recorder.elapsedMs)}
          </span>
        )}
      </div>

      <BaseViewBody>
        {playback.error && (
          <p className="error mb-2 text-sm" role="alert">
            {playback.error}{' '}
            <button
              className="underline"
              onClick={() => dispatch(setPlaybackError(null))}
            >
              dismiss
            </button>
          </p>
        )}

        {!isIndexedDbAvailable() && (
          <p className="warning mb-2 text-sm">
            This browser will not let the dashboard store recordings, so new
            runs cannot be saved.
          </p>
        )}

        {/* Everything about reviewing a recording lives in one panel that only
            exists while one is open, so the idle view is just a list. */}
        {isOpen && (
          <section className="mb-4 rounded-md border border-amber-500/60 bg-amber-50/60 p-2 dark:bg-amber-500/5">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="min-w-0 truncate text-sm font-medium">
                <span className="text-gray-500 dark:text-slate-400">
                  {/* Matches the word the header bar uses for the same state.
                      Two names for one thing is most of what made this
                      confusing. */}
                  {isPlaybackMode ? 'Reviewing' : 'Comparing'}{' '}
                </span>
                {playback.meta?.name}
              </h3>
              <button
                className={SMALL_BUTTON_FIXED}
                onClick={() => dispatch(exitPlayback())}
              >
                Close recording
              </button>
            </div>

            {/* Alignment is the whole claim of this mode, so it has to say
                which state it is in. The failure everyone hits is comparing
                against a run that has not started yet. */}
            {playback.mode === 'ghost' && (
              <p
                className="mb-2 text-xs text-gray-500 dark:text-slate-400"
                title={alignState(playback).detail}
              >
                {alignState(playback).label}
              </p>
            )}

            {/* Opening a recording used to stop capturing the match you were
                in, without saying so. It no longer does, and saying so is half
                the fix. */}
            {playback.recorder.active && (
              <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
                Live robot still being recorded
              </p>
            )}

            <TransportBar
              cursorMs={playback.cursorMs}
              durationMs={playback.durationMs}
              isPlaying={playback.isPlaying}
              speed={playback.speed}
              loop={playback.loop}
              markers={playback.markers}
              statusTimeline={playback.statusTimeline}
              density={playback.density}
              onSeek={handleSeek}
              onPlay={() => dispatch(playPlayback())}
              onPause={() => dispatch(pausePlayback())}
              onSetSpeed={(s) => dispatch(setPlaybackSpeed(s))}
              onSetLoop={(l) => dispatch(setPlaybackLoop(l))}
              onStep={handleStep}
              followsLive={playback.mode === 'ghost'}
            />

            <div className="mt-3 border-t border-gray-200 pt-2 dark:border-slate-600">
              <p className="mb-1 text-xs text-gray-500 dark:text-slate-400">
                Show this recording
              </p>
              <div className="flex rounded border border-gray-300 dark:border-slate-600">
                {VIEW_OPTIONS.map((o) => (
                  <button
                    key={o.mode}
                    title={o.hint}
                    className={clsx(
                      'flex-1 py-1 px-2 text-sm transition first:rounded-l last:rounded-r',
                      playback.mode === o.mode
                        ? 'bg-primary-600 font-medium text-white'
                        : 'hover:bg-white dark:hover:bg-slate-700',
                    )}
                    onClick={() => dispatch(setPlaybackMode(o.mode))}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {playback.mode === 'ghost' && (
                <label
                  className="mt-2 flex items-center gap-2 text-xs"
                  htmlFor="ghostOpacity"
                >
                  <span className="shrink-0">Field overlay opacity</span>
                  <input
                    id="ghostOpacity"
                    type="range"
                    className="flex-1"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={playback.ghostOpacity}
                    onChange={(e) =>
                      dispatch(setGhostOpacity(parseFloat(e.target.value)))
                    }
                  />
                  <span className="w-8 shrink-0 text-right font-mono">
                    {Math.round(playback.ghostOpacity * 100)}%
                  </span>
                </label>
              )}
            </div>
          </section>
        )}

        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-medium">Recordings</h3>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept=".json"
              multiple
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => {
                void handleImport(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              className={SMALL_BUTTON}
              onClick={() => fileInputRef.current?.click()}
            >
              Import
            </button>
          </div>
        </div>

        <RecordingLibrary
          entries={entries}
          openId={playback.recordingId}
          onSelect={handleSelect}
          onRename={handleRename}
          onDelete={handleDelete}
          onExport={handleExport}
        />

        {/* Capture settings are secondary: you set them once and forget them. */}
        <div className="mt-4 border-t border-gray-200 pt-2 dark:border-slate-600">
          <h3 className="mb-1 font-medium">Capture</h3>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="rounded text-primary-600"
                checked={playback.recorder.enabled}
                onChange={(e) => dispatch(setRecorderEnabled(e.target.checked))}
              />
              Record op modes automatically
            </label>
            <button
              className={SMALL_BUTTON}
              title={
                playback.recorder.active
                  ? 'Stop this recording'
                  : 'Start a recording without waiting for an op mode'
              }
              onClick={() =>
                dispatch(
                  playback.recorder.active ? stopRecording() : startRecording(),
                )
              }
            >
              {playback.recorder.active ? 'Stop recording' : 'Record now'}
            </button>
          </div>

          {playback.recorder.active ? (
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              {playback.recorder.frames.toLocaleString()} frames,{' '}
              {formatBytes(playback.recorder.bytes)} so far
            </p>
          ) : (
            storage.quota > 0 && (
              <p
                className="mt-1 text-xs text-gray-500 dark:text-slate-400"
                title={
                  'Automatic recordings are deleted oldest first once there ' +
                  'are more than 10. Renaming or downloading one keeps it for ' +
                  'good, and so does anything you imported.'
                }
              >
                Using {formatBytes(storage.usage)} of browser storage
                <HelpMark />
              </p>
            )
          )}
        </div>
      </BaseViewBody>
    </BaseView>
  );
};

export default RecorderView;
