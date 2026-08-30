import clsx from 'clsx';

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
  onHeader = false,
}: {
  source: ReplaySource;
  onHeader?: boolean;
}) => (
  <span
    className={clsx(
      'shrink-0 rounded px-1.5 py-0.5 align-middle text-xs font-bold uppercase tracking-wide',
      onHeader
        ? // Pale amber reaches only ~4:1 on the amber-700 and primary-600 headers.
          'border border-white/70 text-white'
        : [
            'ml-2',
            // Gray-900 text: white on amber-500 is 2.15:1, amber-900 only 4.2:1,
            // and Tailwind 3.2.4 has no amber-950.
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
