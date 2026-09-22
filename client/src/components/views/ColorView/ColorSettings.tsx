import clsx from 'clsx';

import { NORMALIZATION_LABELS, NormalizationMode } from './colorUtils';

const inputClass = clsx(
  'rounded border border-gray-200 bg-gray-100 px-2 py-1 text-sm transition',
  'focus:border-primary-500 focus:ring-primary-500',
  'dark:border-slate-500/80 dark:bg-slate-700 dark:text-slate-200',
);

type ColorSettingsProps = {
  mode: NormalizationMode;
  onModeChange: (mode: NormalizationMode) => void;
  divisor: number;
  onDivisorChange: (divisor: number) => void;
};

const ColorSettings = ({
  mode,
  onModeChange,
  divisor,
  onDivisorChange,
}: ColorSettingsProps) => {
  return (
    <div className="mb-4 rounded border border-gray-200 p-3 dark:border-slate-700">
      <h3 className="mb-2 font-medium">Display</h3>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="color-normalization">
          Normalization
        </label>
        <select
          id="color-normalization"
          className={inputClass}
          value={mode}
          onChange={(e) => onModeChange(e.target.value as NormalizationMode)}
        >
          {Object.entries(NORMALIZATION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {mode === 'manual' && (
          <input
            className={clsx(inputClass, 'w-24')}
            type="number"
            min={1}
            step={1}
            aria-label="Manual divisor"
            value={divisor}
            onChange={(e) => onDivisorChange(Number(e.target.value))}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        Raw counts depend on the sensor and its gain. Auto keeps hue and
        saturation but throws away brightness, which is usually the most stable
        way to tell game elements apart.
      </p>
    </div>
  );
};

export default ColorSettings;
