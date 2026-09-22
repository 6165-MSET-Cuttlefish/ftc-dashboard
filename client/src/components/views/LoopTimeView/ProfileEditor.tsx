import { useState } from 'react';
import clsx from 'clsx';

import { ReactComponent as AddIcon } from '@/assets/icons/add.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';

import {
  LoopProfile,
  LoopSegment,
  TimeUnit,
  UNIT_LABELS,
  labelFromKey,
  newSegment,
  sanitizeStore,
} from './profiles';

const inputClass = clsx(
  'rounded border border-gray-200 bg-gray-100 px-2 py-1 text-sm transition',
  'focus:border-primary-500 focus:ring-primary-500',
  'dark:border-slate-500/80 dark:bg-slate-700 dark:text-slate-200',
);

const buttonClass = clsx(
  'rounded border border-gray-300 px-2 py-1 text-xs transition',
  'hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40',
  'dark:border-slate-600 dark:hover:bg-slate-700',
);

const SUM_OF_SEGMENTS = '__sum__';

type ProfileEditorProps = {
  profiles: LoopProfile[];
  active: LoopProfile;
  availableKeys: string[];
  onSelectProfile: (id: string) => void;
  onChangeProfile: (profile: LoopProfile) => void;
  onCreateProfile: () => void;
  onDuplicateProfile: () => void;
  onDeleteProfile: () => void;
  onImportProfile: (profile: LoopProfile) => void;
};

const ProfileEditor = ({
  profiles,
  active,
  availableKeys,
  onSelectProfile,
  onChangeProfile,
  onCreateProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onImportProfile,
}: ProfileEditorProps) => {
  const [prefix, setPrefix] = useState('loop');
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferText, setTransferText] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);

  // The loop total isn't a part of the loop, so it never offers itself as a
  // segment — otherwise `LoopTimer`'s `<prefix>/total` gets auto-added and
  // doubles the bar.
  const usedKeys = new Set(active.segments.map((s) => s.key));
  const unusedKeys = availableKeys.filter(
    (key) => !usedKeys.has(key) && key !== active.totalKey,
  );

  const setSegments = (segments: LoopSegment[]) =>
    onChangeProfile({ ...active, segments });

  const updateSegment = (id: string, patch: Partial<LoopSegment>) =>
    setSegments(
      active.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );

  const moveSegment = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= active.segments.length) return;

    const reordered = [...active.segments];
    [reordered[index], reordered[target]] = [
      reordered[target],
      reordered[index],
    ];
    setSegments(reordered);
  };

  const addMatchingKeys = () => {
    const needle = prefix.trim().toLowerCase();
    const matches = unusedKeys.filter(
      (key) => needle === '' || key.toLowerCase().includes(needle),
    );
    if (matches.length === 0) return;

    // `LoopTimer` publishes the whole loop as `<prefix>/total`. Claim it as the
    // total rather than as another slice of the bar.
    const totalMatch =
      active.totalKey === null
        ? matches.find((key) => /(^|[/.])total$/i.test(key)) ?? null
        : null;

    const segmentKeys = matches.filter((key) => key !== totalMatch);

    onChangeProfile({
      ...active,
      totalKey: totalMatch ?? active.totalKey,
      segments: [
        ...active.segments,
        ...segmentKeys.map((key, i) =>
          newSegment(key, active.segments.length + i),
        ),
      ],
    });
  };

  const exportProfile = () => {
    setTransferText(JSON.stringify(active, null, 2));
    setTransferError(null);
    setShowTransfer(true);
  };

  const importProfile = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(transferText);
    } catch {
      setTransferError('That is not valid JSON.');
      return;
    }

    // Reuse the store sanitizer so an imported profile gets the same
    // validation as anything loaded from localStorage.
    const { profiles: imported } = sanitizeStore({
      profiles: [parsed],
      activeId: '',
    });
    const candidate = imported[0];

    if (candidate.segments.length === 0 && candidate.totalKey === null) {
      setTransferError('No segments or total key found in that profile.');
      return;
    }

    setTransferError(null);
    onImportProfile(candidate);
  };

  return (
    <div className="mb-4 rounded border border-gray-200 p-3 dark:border-slate-700">
      <h3 className="mb-2 font-medium">Profile</h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          aria-label="Active profile"
          value={active.id}
          onChange={(e) => onSelectProfile(e.target.value)}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <input
          className={clsx(inputClass, 'flex-1')}
          aria-label="Profile name"
          value={active.name}
          onChange={(e) => onChangeProfile({ ...active, name: e.target.value })}
        />
        <button type="button" className={buttonClass} onClick={onCreateProfile}>
          New
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={onDuplicateProfile}
        >
          Duplicate
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={profiles.length <= 1}
          title={
            profiles.length <= 1
              ? 'At least one profile is required'
              : `Delete ${active.name}`
          }
          onClick={onDeleteProfile}
        >
          Delete
        </button>
        <button type="button" className={buttonClass} onClick={exportProfile}>
          Share
        </button>
      </div>

      {showTransfer && (
        <div className="mt-2">
          <textarea
            className={clsx(inputClass, 'h-28 w-full font-mono text-xs')}
            aria-label="Profile JSON"
            value={transferText}
            spellCheck={false}
            onChange={(e) => setTransferText(e.target.value)}
          />
          {transferError !== null && (
            <p className="text-xs text-red-500">{transferError}</p>
          )}
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              className={buttonClass}
              onClick={importProfile}
            >
              Import as new profile
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setShowTransfer(false)}
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            Copy this JSON to move a breakdown between machines, or paste one in
            and import it.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          Values are in
          <select
            className={inputClass}
            value={active.unit}
            onChange={(e) =>
              onChangeProfile({ ...active, unit: e.target.value as TimeUnit })
            }
          >
            {Object.entries(UNIT_LABELS).map(([unit, label]) => (
              <option key={unit} value={unit}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Loop total
          <select
            className={inputClass}
            value={active.totalKey ?? SUM_OF_SEGMENTS}
            onChange={(e) =>
              onChangeProfile({
                ...active,
                totalKey:
                  e.target.value === SUM_OF_SEGMENTS ? null : e.target.value,
              })
            }
          >
            <option value={SUM_OF_SEGMENTS}>Sum of segments</option>
            {[
              ...new Set(
                active.totalKey === null
                  ? availableKeys
                  : [...availableKeys, active.totalKey],
              ),
            ]
              .sort()
              .map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Budget (ms)
          <input
            className={clsx(inputClass, 'w-20')}
            type="number"
            min={0}
            step={1}
            value={active.budgetMs}
            onChange={(e) =>
              onChangeProfile({
                ...active,
                budgetMs: Math.max(0, Number(e.target.value)),
              })
            }
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Segments</h3>
        <div className="flex flex-wrap items-center gap-1">
          <input
            className={clsx(inputClass, 'w-24')}
            aria-label="Key filter"
            placeholder="loop"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={unusedKeys.length === 0}
            title="Add every unused telemetry key containing this text"
            onClick={addMatchingKeys}
          >
            Auto-add matching
          </button>
          <select
            className={clsx(inputClass, 'max-w-[10rem]')}
            aria-label="Add a segment"
            value=""
            disabled={unusedKeys.length === 0}
            onChange={(e) => {
              if (e.target.value === '') return;
              setSegments([
                ...active.segments,
                newSegment(e.target.value, active.segments.length),
              ]);
            }}
          >
            <option value="">
              {unusedKeys.length === 0 ? 'No unused keys' : 'Add key…'}
            </option>
            {unusedKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
      </div>

      {active.segments.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
          No segments yet. Send numeric telemetry from your op mode, then add
          the keys that make up your loop.
        </p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
              <th className="w-10 font-medium">Color</th>
              <th className="font-medium">Label</th>
              <th className="font-medium">Telemetry key</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {active.segments.map((segment, index) => {
              const keyOptions = [
                ...new Set([...availableKeys, segment.key]),
              ].sort();

              return (
                <tr key={segment.id}>
                  <td className="py-1">
                    <input
                      type="color"
                      aria-label={`${segment.label} color`}
                      className="h-7 w-8 cursor-pointer rounded border border-gray-300 bg-transparent p-0.5 dark:border-slate-600"
                      value={segment.color.toLowerCase()}
                      onChange={(e) =>
                        updateSegment(segment.id, { color: e.target.value })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className={clsx(inputClass, 'w-full')}
                      aria-label={`${segment.label} label`}
                      value={segment.label}
                      onChange={(e) =>
                        updateSegment(segment.id, { label: e.target.value })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      className={clsx(inputClass, 'w-full')}
                      aria-label={`${segment.label} telemetry key`}
                      value={segment.key}
                      onChange={(e) =>
                        updateSegment(segment.id, {
                          key: e.target.value,
                          label:
                            segment.label === labelFromKey(segment.key)
                              ? labelFromKey(e.target.value)
                              : segment.label,
                        })
                      }
                    >
                      {keyOptions.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={index === 0}
                        title="Move up"
                        onClick={() => moveSegment(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={index === active.segments.length - 1}
                        title="Move down"
                        onClick={() => moveSegment(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        title={`Remove ${segment.label}`}
                        onClick={() =>
                          setSegments(
                            active.segments.filter((s) => s.id !== segment.id),
                          )
                        }
                      >
                        <DeleteIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {availableKeys.length === 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs text-gray-500 dark:text-slate-400">
          <AddIcon className="h-3 w-3" />
          No numeric telemetry seen yet — start an op mode that reports timings.
        </p>
      )}
    </div>
  );
};

export default ProfileEditor;
