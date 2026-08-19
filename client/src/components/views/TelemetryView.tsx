import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import BaseView, {
  BaseViewHeading,
  BaseViewBody,
  BaseViewProps,
  BaseViewHeadingProps,
} from './BaseView';
import { RootState } from '@/store/reducers';

type TelemetryViewProps = BaseViewProps & BaseViewHeadingProps;

// Incoming packets rewrite the rendered lines several times a second, which
// clears any selection sitting inside them. Updates are held while the user has
// one touching the view so that ordinary copy and paste works; they resume with
// the next packet once the selection collapses.
function hasSelectionIn(node: HTMLElement | null) {
  if (node === null) return false;

  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed) return false;

  for (let i = 0; i < selection.rangeCount; i++) {
    if (selection.getRangeAt(i).intersectsNode(node)) return true;
  }

  return false;
}

const TelemetryView = ({
  isDraggable = false,
  isUnlocked = false,
}: TelemetryViewProps) => {
  const [log, setLog] = useState<string[]>([]);
  const [data, setData] = useState<{ [key: string]: string }>({});
  const [filter, setFilter] = useState('');

  const bodyRef = useRef<HTMLDivElement>(null);

  const packets = useSelector((state: RootState) => state.telemetry);
  useEffect(() => {
    if (packets.length === 0) {
      setLog([]);
      setData({});
      return;
    }

    if (hasSelectionIn(bodyRef.current)) return;

    setLog((prevLog) =>
      packets.reduce(
        (acc, { log: newLog }) => (newLog.length === 0 ? acc : newLog),
        prevLog,
      ),
    );

    setData((prevData) =>
      packets.reduce(
        (acc, { data: newData }) =>
          Object.keys(newData).reduce(
            (acc, k) => ({ ...acc, [k]: newData[k] }),
            acc,
          ),
        prevData,
      ),
    );
  }, [packets]);

  const query = filter.trim().toLowerCase();
  const matches = (text: string) =>
    query === '' || text.toLowerCase().includes(query);

  const telemetryLines = Object.keys(data)
    .filter(matches)
    .map((key) => (
      <span
        key={key}
        dangerouslySetInnerHTML={{ __html: `${key}: ${data[key]}<br />` }}
      />
    ));

  const telemetryLog = log
    .filter(matches)
    .map((line, i) => (
      <span key={i} dangerouslySetInnerHTML={{ __html: `${line}<br />` }} />
    ));

  return (
    <BaseView isUnlocked={isUnlocked}>
      <div className="flex items-center">
        <BaseViewHeading isDraggable={isDraggable}>Telemetry</BaseViewHeading>
        <input
          className="mr-4 w-20 shrink-0 rounded border-0 bg-gray-100 px-2 py-0.5 text-sm transition-all placeholder:text-gray-400 focus:w-32 focus:ring-1 focus:ring-primary-500 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500"
          type="text"
          placeholder="Filter"
          aria-label="Filter telemetry"
          value={filter}
          onChange={(evt) => setFilter(evt.target.value)}
          onKeyDown={(evt) => {
            if (evt.key === 'Escape') setFilter('');
          }}
        />
      </div>
      <BaseViewBody>
        <div ref={bodyRef}>
          <p>{telemetryLines}</p>
          <p>{telemetryLog}</p>
        </div>
      </BaseViewBody>
    </BaseView>
  );
};

export default TelemetryView;
