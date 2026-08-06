import { useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Transition } from '@headlessui/react';
import clsx from 'clsx';

import BaseView, {
  BaseViewHeading,
  BaseViewBody,
  BaseViewProps,
  BaseViewHeadingProps,
} from '@/components/views/BaseView';
import sanitizeTelemetryHtml from '@/components/views/TelemetryView/sanitizeTelemetryHtml';
import { RootState } from '@/store/reducers';
import { TelemetryDisplayFormat } from '@/store/types/telemetry';
import buildFrame, {
  DisplayedLine,
  Frame,
} from '@/components/views/TelemetryView/buildFrame';
import useOnClickOutside from '@/hooks/useOnClickOutside';

import { ReactComponent as MoreVertSVG } from '@/assets/icons/more_vert.svg';

type TelemetryViewProps = BaseViewProps & BaseViewHeadingProps;

// Matches the sanitizer's own limit.
const MAX_VALUE_LENGTH = 16384;

// `null` follows each packet's own format; the others override every line.
type FormatOverride = TelemetryDisplayFormat | null;

const FORMAT_OPTIONS: { label: string; value: FormatOverride }[] = [
  { label: 'Auto', value: null },
  { label: 'Classic', value: 'CLASSIC' },
  { label: 'Monospace', value: 'MONOSPACE' },
  { label: 'HTML', value: 'HTML' },
];

const TelemetryView = ({
  isDraggable = false,
  isUnlocked = false,
}: TelemetryViewProps) => {
  const packets = useSelector((state: RootState) => state.telemetry);

  // A drawing-only batch leaves the last real frame in place.
  const lastFrame = useRef<Frame>({ entries: [], log: [] });

  const { entries, log } = useMemo(() => {
    const frame = buildFrame(packets);
    if (frame !== null) lastFrame.current = frame;
    return lastFrame.current;
  }, [packets]);

  const [formatOverride, setFormatOverride] = useState<FormatOverride>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);

  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);

  useOnClickOutside(
    menuRef,
    () => {
      if (isMenuVisible) setIsMenuVisible(false);
    },
    [menuButtonRef],
  );

  // Per line, not per container: lines from different sources can be in different formats.
  const renderLine = (key: string, line: DisplayedLine) => {
    const { caption, value, separator } = line;
    const displayFormat = formatOverride ?? line.displayFormat;

    // The same bound the sanitizer applies, so a runaway value cannot bloat the DOM.
    const renderText = (text: string) =>
      displayFormat === 'HTML'
        ? sanitizeTelemetryHtml(text)
        : text.length > MAX_VALUE_LENGTH
        ? `${text.slice(0, MAX_VALUE_LENGTH)}\u2026`
        : text;

    return (
      <div
        key={key}
        className={clsx(
          'break-words',
          displayFormat === 'MONOSPACE' && 'font-mono',
          displayFormat === 'HTML' ? 'telemetry-html' : 'whitespace-pre-wrap',
        )}
      >
        {/* An empty div collapses to nothing, so a blank line gets a non-breaking space to keep
            the height the Driver Station gives it. */}
        {caption == null &&
        (displayFormat === 'HTML' ? value.trim() === '' : value === '') ? (
          ' '
        ) : (
          <>
            {caption != null && (
              <>
                {renderText(caption)}
                {separator}
              </>
            )}
            {renderText(value)}
          </>
        )}
      </div>
    );
  };

  return (
    <BaseView isUnlocked={isUnlocked}>
      <div className="flex-center">
        <BaseViewHeading isDraggable={isDraggable}>
          Telemetry
          {/* An override is easy to set and forget, so say so rather than leaving someone to
              wonder why their telemetry renders differently here than anywhere else. */}
          {formatOverride !== null && (
            <span className="text-neutral-gray-400 ml-2 align-middle text-sm font-normal">
              {formatOverride.toLowerCase()}
            </span>
          )}
        </BaseViewHeading>
        <div className="mr-3 flex items-center space-x-1">
          <div className="relative inline-block" style={{ zIndex: 99 }}>
            <button
              ref={menuButtonRef}
              className="icon-btn h-8 w-8"
              onClick={() => setIsMenuVisible(!isMenuVisible)}
            >
              <MoreVertSVG className="h-6 w-6" />
            </button>
            <Transition
              show={isMenuVisible}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <div
                ref={menuRef}
                className="absolute right-0 mt-2 origin-top-right rounded-md border border-gray-200 bg-white py-2 shadow-lg outline-none dark:bg-slate-700"
              >
                <p className="mb-1 whitespace-nowrap border-b border-gray-100 pb-1 pl-3 pr-3 text-sm leading-5">
                  Display Format
                </p>
                {FORMAT_OPTIONS.map(({ label, value }) => (
                  <button
                    key={label}
                    className={clsx(
                      'block w-full whitespace-nowrap px-3 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-slate-600',
                      formatOverride === value && 'font-medium',
                    )}
                    onClick={() => {
                      setFormatOverride(value);
                      setIsMenuVisible(false);
                    }}
                  >
                    <span className="inline-block w-4">
                      {formatOverride === value ? '✓' : ''}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </Transition>
          </div>
        </div>
      </div>
      <BaseViewBody>
        <div>
          {entries.map((entry, i) => renderLine(`item-${i}`, entry))}
          {/* The log always sits below the telemetry items, matching the Driver Station. */}
          {log.map((line, i) => renderLine(`log-${i}`, line))}
        </div>
      </BaseViewBody>
    </BaseView>
  );
};

export default TelemetryView;
