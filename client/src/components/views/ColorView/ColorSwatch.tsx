import clsx from 'clsx';

import { RGB, readableTextColor, rgbToHex } from './colorUtils';

type ColorSwatchProps = {
  color: RGB;
  label?: string;
  className?: string;
  title?: string;
};

/** A solid block of the given color with an optional caption laid over it. */
const ColorSwatch = ({ color, label, className, title }: ColorSwatchProps) => (
  <div
    className={clsx(
      'flex-center overflow-hidden rounded border border-gray-300 dark:border-slate-600',
      className,
    )}
    style={{ background: rgbToHex(color) }}
    title={title ?? rgbToHex(color)}
  >
    {label !== undefined && (
      <span
        className="px-1 font-mono text-xs font-medium"
        style={{ color: readableTextColor(color) }}
      >
        {label}
      </span>
    )}
  </div>
);

export default ColorSwatch;
