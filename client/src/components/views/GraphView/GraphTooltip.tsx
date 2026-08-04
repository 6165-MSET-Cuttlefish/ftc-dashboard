import clsx from 'clsx';

import { formatValue, HoverInfo } from './Graph';

const CURSOR_OFFSET = 14;
// rough per-row and chrome heights, used to keep the tooltip on screen without
// having to measure it after layout
const ROW_HEIGHT = 18;
const CHROME_HEIGHT = 16;

type GraphTooltipProps = {
  hover: HoverInfo;
  // dimensions of the container the tooltip is positioned within
  width: number;
  height: number;
};

export default function GraphTooltip({
  hover,
  width,
  height,
}: GraphTooltipProps) {
  const { cursorX, cursorY, entries, nearestName } = hover;

  // flip to the other side of the cursor when close to the right edge
  const flip = cursorX > width / 2;

  const estHeight = entries.length * ROW_HEIGHT + CHROME_HEIGHT;
  const top = Math.min(
    Math.max(cursorY, estHeight / 2),
    height - estHeight / 2,
  );

  return (
    <div
      className={clsx(
        'pointer-events-none absolute z-10 rounded border py-1 px-2 shadow-lg',
        'border-gray-200 bg-white/95 text-gray-900',
        'dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-100',
      )}
      style={{
        left: cursorX + (flip ? -CURSOR_OFFSET : CURSOR_OFFSET),
        top,
        transform: `translate(${flip ? '-100%' : '0'}, -50%)`,
      }}
    >
      <table className="border-separate" style={{ borderSpacing: '0 1px' }}>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.name}
              className={clsx(
                'text-xs leading-tight',
                entry.name === nearestName ? 'font-bold' : 'font-medium',
              )}
            >
              <td className="pr-1 align-middle">
                <span
                  className="inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: entry.color }}
                />
              </td>
              <td className="whitespace-nowrap pr-3 align-middle">
                {entry.name}
              </td>
              <td className="whitespace-nowrap text-right align-middle font-mono">
                {formatValue(entry.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
