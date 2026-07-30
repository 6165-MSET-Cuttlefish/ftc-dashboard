import { useState } from 'react';
import clsx from 'clsx';

import { ReactComponent as ExpandMoreIcon } from '@/assets/icons/expand_more.svg';
import { ReactComponent as DragIndicatorIcon } from '@/assets/icons/drag_indicator.svg';

import { ColorPalette, ColorSwatchButton } from './ColorPicker';

// moves the item at `from` to `to`, leaving the rest in order
export function moveItem<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || from >= items.length) return items;

  const clamped = Math.max(0, Math.min(to, items.length - 1));

  const reordered = [...items];
  const [item] = reordered.splice(from, 1);
  reordered.splice(clamped, 0, item);

  return reordered;
}

type GraphSeriesListProps = {
  // series names in layer order; the first is drawn in front of the rest
  seriesKeys: string[];
  colors: { [key: string]: string };
  onReorder: (seriesKeys: string[]) => void;
  onColorChange: (key: string, color: string) => void;
  onColorReset: (key: string) => void;
};

const GraphSeriesList = ({
  seriesKeys,
  colors,
  onReorder,
  onColorChange,
  onColorReset,
}: GraphSeriesListProps) => {
  // only one palette is open at a time to keep the list compact
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const reorderable = seriesKeys.length > 1;

  const move = (from: number, to: number) => {
    const reordered = moveItem(seriesKeys, from, to);
    if (reordered !== seriesKeys) onReorder(reordered);
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  return (
    <ul
      className="mt-1"
      // So the highlight never lingers on a row the drag left.
      onDragLeave={(evt) => {
        if (evt.currentTarget.contains(evt.relatedTarget as Node | null))
          return;

        setDropIndex(null);
      }}
    >
      {seriesKeys.map((key, i) => (
        <li
          key={key}
          // The whole item accepts the drop, including an expanded palette.
          onDragOver={(evt) => {
            if (dragIndex === null) return;

            evt.preventDefault();
            evt.dataTransfer.dropEffect = 'move';
            setDropIndex(i);
          }}
          onDrop={(evt) => {
            if (dragIndex === null) return;

            evt.preventDefault();
            move(dragIndex, i);
            endDrag();
          }}
        >
          {/* only the row starts a drag: keeping the palette out of the
              draggable subtree leaves its text field selectable */}
          <div
            draggable={reorderable}
            onDragStart={(evt) => {
              setDragIndex(i);
              evt.dataTransfer.effectAllowed = 'move';
              // Firefox ignores drags that carry no data
              evt.dataTransfer.setData('text/plain', key);
            }}
            onDragEnd={endDrag}
            className={clsx(
              'flex items-center gap-1 rounded py-0.5 transition',
              reorderable && 'cursor-grab',
              dragIndex === i && 'opacity-40',
              dropIndex === i &&
                dragIndex !== null &&
                dragIndex !== i &&
                'bg-primary-100 dark:bg-slate-700',
            )}
          >
            {reorderable && (
              <>
                <DragIndicatorIcon
                  className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="icon-btn h-5 w-5 shrink-0 disabled:opacity-30"
                  title={`Move ${key} one layer forward`}
                  aria-label={`Move ${key} one layer forward`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ExpandMoreIcon className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  className="icon-btn h-5 w-5 shrink-0 disabled:opacity-30"
                  title={`Move ${key} one layer back`}
                  aria-label={`Move ${key} one layer back`}
                  disabled={i === seriesKeys.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ExpandMoreIcon className="h-4 w-4" />
                </button>
              </>
            )}

            <ColorSwatchButton
              color={colors[key]}
              title={`Change the color of ${key}`}
              expanded={openKey === key}
              onClick={() => setOpenKey(openKey === key ? null : key)}
            />

            <span className="ml-1 truncate" title={key}>
              {key}
            </span>
          </div>

          {openKey === key && (
            <ColorPalette
              color={colors[key]}
              onChange={(color) => onColorChange(key, color)}
              onReset={() => onColorReset(key)}
              onClose={() => setOpenKey(null)}
            />
          )}
        </li>
      ))}
    </ul>
  );
};

export default GraphSeriesList;
