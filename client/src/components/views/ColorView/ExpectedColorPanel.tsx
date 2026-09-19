import { useState } from 'react';
import clsx from 'clsx';

import ColorSwatch from './ColorSwatch';
import {
  RGB,
  deltaE2000,
  hexToRgb,
  hueDistance,
  normalizeToDisplay,
  parseColorInput,
  rgbToHex,
  rgbToHsv,
} from './colorUtils';
import {
  COLOR_PRESETS,
  ExpectedColor,
  MAX_TOLERANCE,
  MIN_TOLERANCE,
} from './expectedColor';

const inputClass = clsx(
  'rounded border border-gray-200 bg-gray-100 px-2 py-1 text-sm transition',
  'focus:border-primary-500 focus:ring-primary-500',
  'dark:border-slate-500/80 dark:bg-slate-700 dark:text-slate-200',
);

type StatRowProps = {
  label: string;
  expected: string;
  sensed: string;
};

const StatRow = ({ label, expected, sensed }: StatRowProps) => (
  <tr>
    <td className="py-1 pr-3 text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
      {label}
    </td>
    <td className="py-1 pr-3 font-mono text-sm">{expected}</td>
    <td className="py-1 font-mono text-sm">{sensed}</td>
  </tr>
);

type ExpectedColorPanelProps = {
  expected: ExpectedColor;
  onExpectedChange: (expected: ExpectedColor) => void;
  sensed: RGB;
};

const ExpectedColorPanel = ({
  expected,
  onExpectedChange,
  sensed,
}: ExpectedColorPanelProps) => {
  // Lets the text box hold whatever the user is mid-typing without stomping
  // on it every render, while still falling back to the last valid color.
  const [draft, setDraft] = useState(expected.hex);

  const commitDraft = (value: string) => {
    const parsed = parseColorInput(value);
    if (parsed !== null) {
      onExpectedChange({ ...expected, hex: rgbToHex(parsed) });
    } else {
      setDraft(expected.hex);
    }
  };

  const expectedRgb = hexToRgb(expected.hex) ?? { r: 0, g: 0, b: 0 };
  const expectedHsv = rgbToHsv(expectedRgb);
  const sensedHsv = rgbToHsv(sensed);

  // Sensor brightness swings with distance/lighting and normalization mode,
  // so matching compares colors scaled to the same peak channel (hue/chroma
  // only) rather than penalizing brightness differences via raw ΔE.
  const deltaE = deltaE2000(
    normalizeToDisplay(expectedRgb, 'auto'),
    normalizeToDisplay(sensed, 'auto'),
  );
  const hueDelta = hueDistance(expectedHsv.h, sensedHsv.h);
  const withinTolerance = deltaE <= expected.tolerance;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label
            className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400"
            htmlFor="expected-color-input"
          >
            Expected color
          </label>
          <input
            id="expected-color-input"
            className={clsx(inputClass, 'w-36')}
            placeholder="#rrggbb or r, g, b"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commitDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400"
            htmlFor="expected-color-preset"
          >
            Preset
          </label>
          <select
            id="expected-color-preset"
            className={inputClass}
            value=""
            onChange={(e) => {
              if (e.target.value === '') return;
              setDraft(e.target.value);
              onExpectedChange({ ...expected, hex: e.target.value });
            }}
          >
            <option value="">Choose a preset…</option>
            {COLOR_PRESETS.map((preset) => (
              <option key={preset.hex} value={preset.hex}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400"
            htmlFor="expected-color-tolerance"
          >
            Tol ΔE
          </label>
          <input
            id="expected-color-tolerance"
            className={clsx(inputClass, 'w-16')}
            type="number"
            min={MIN_TOLERANCE}
            max={MAX_TOLERANCE}
            step={1}
            value={expected.tolerance}
            onChange={(e) =>
              onExpectedChange({
                ...expected,
                tolerance: Math.min(
                  MAX_TOLERANCE,
                  Math.max(MIN_TOLERANCE, Number(e.target.value)),
                ),
              })
            }
          />
        </div>

        <span
          className={clsx(
            'mb-0.5 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide',
            withinTolerance
              ? 'bg-green-500 text-white'
              : 'bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-slate-400',
          )}
        >
          {withinTolerance ? 'Match' : 'No match'}
        </span>
      </div>

      <div className="mt-3 flex items-stretch gap-3">
        <div className="flex-1">
          <ColorSwatch color={expectedRgb} className="h-20 w-full" />
          <p className="mt-1 text-center font-mono text-xs text-gray-500 dark:text-slate-400">
            Expected - {rgbToHex(expectedRgb)}
          </p>
        </div>
        <div className="flex-1">
          <ColorSwatch color={sensed} className="h-20 w-full" />
          <p className="mt-1 text-center font-mono text-xs text-gray-500 dark:text-slate-400">
            Sensed - {rgbToHex(sensed)}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded border border-gray-200 p-3 dark:border-slate-700">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
              <th className="pb-1 font-medium"> </th>
              <th className="pb-1 font-medium">Expected</th>
              <th className="pb-1 font-medium">Sensed</th>
            </tr>
          </thead>
          <tbody>
            <StatRow
              label="Hex"
              expected={rgbToHex(expectedRgb)}
              sensed={rgbToHex(sensed)}
            />
            <StatRow
              label="R"
              expected={`${expectedRgb.r}`}
              sensed={`${Math.round(sensed.r)}`}
            />
            <StatRow
              label="G"
              expected={`${expectedRgb.g}`}
              sensed={`${Math.round(sensed.g)}`}
            />
            <StatRow
              label="B"
              expected={`${expectedRgb.b}`}
              sensed={`${Math.round(sensed.b)}`}
            />
            <StatRow
              label="Hue"
              expected={`${expectedHsv.h.toFixed(0)}°`}
              sensed={`${sensedHsv.h.toFixed(0)}°`}
            />
            <StatRow
              label="Sat"
              expected={`${(expectedHsv.s * 100).toFixed(0)}%`}
              sensed={`${(sensedHsv.s * 100).toFixed(0)}%`}
            />
            <StatRow
              label="Val"
              expected={`${(expectedHsv.v * 100).toFixed(0)}%`}
              sensed={`${(sensedHsv.v * 100).toFixed(0)}%`}
            />
          </tbody>
        </table>
        <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-xs text-gray-500 dark:border-slate-700 dark:text-slate-400">
          <span>ΔE {deltaE.toFixed(1)}</span>
          <span>Δhue {hueDelta.toFixed(0)}°</span>
        </div>
      </div>
    </div>
  );
};

export default ExpectedColorPanel;
