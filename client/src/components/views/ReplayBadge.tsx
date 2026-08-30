import clsx from 'clsx';

/**
 * Marks what a panel is showing while a recording is open.
 *
 *   'replacing'  showing the recording and nothing else
 *   'alongside'  showing live data with the recording drawn behind it
 *   'live'       still purely live while other panels show the recording
 *
 * Only panels that actually change get one: in 'alongside' mode the Field and
 * Graph, while Telemetry and Logging stay live and stay unbadged.
 */
export type ReplaySource = 'replacing' | 'alongside' | 'live';

const LABEL: Record<ReplaySource, string> = {
  replacing: 'Recorded',
  alongside: '+ Recorded',
  live: 'Live',
};

const TITLE: Record<ReplaySource, string> = {
  replacing: 'Showing a recording. The live robot is not on screen here.',
  alongside: 'Live, with a recording drawn behind it.',
  live: 'Still the live robot, while other panels show a recording.',
};

const ReplayBadge = ({
  source,
  /** On the header's saturated blue rather than a panel, where the panel
   *  palette is unreadable. */
  onHeader = false,
}: {
  source: ReplaySource;
  onHeader?: boolean;
}) => (
  <span
    className={clsx(
      'shrink-0 rounded px-1.5 py-0.5 align-middle text-xs font-bold uppercase tracking-wide',
      onHeader
        ? // White, not amber-200. The header behind this is amber-700 while
          // reviewing and primary-600 while comparing, and a pale amber on
          // either only reached about 4:1. White clears AA on both and matches
          // the rest of the header's text.
          'border border-white/70 text-white'
        : [
            'ml-2',
            // Solid where the panel is taken over, outlined where live data is
            // still showing. Dark text on the amber, not white: white on
            // amber-500 is 2.15:1. Not amber-900 either (4.15:1), and amber-950
            // does not exist in Tailwind 3.2.4.
            source === 'replacing'
              ? 'bg-amber-500 text-gray-900'
              : 'border border-amber-600 text-amber-700 dark:border-amber-500 dark:text-amber-400',
          ],
    )}
    title={TITLE[source]}
  >
    {LABEL[source]}
  </span>
);

export default ReplayBadge;
