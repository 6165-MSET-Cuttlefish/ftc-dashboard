import { useLayoutEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import BaseView, {
  BaseViewHeading,
  BaseViewBody,
  BaseViewProps,
  BaseViewHeadingProps,
} from './BaseView';
import ReplayBadge from '@/components/views/ReplayBadge';
import { RootState } from '@/store/reducers';

type TelemetryViewProps = BaseViewProps & BaseViewHeadingProps;

/** `fromReplay` travels with the values: on exit `state.playback.mode` flips a render
 *  before the fold drops the recorded strings, which must not take the HTML branch. */
type Fold = {
  fromReplay: boolean;
  data: { [key: string]: string };
  log: string[];
};

const EMPTY: Fold = { fromReplay: false, data: {}, log: [] };

const TelemetryView = ({
  isDraggable = false,
  isUnlocked = false,
}: TelemetryViewProps) => {
  const [fold, setFold] = useState<Fold>(EMPTY);

  const packets = useSelector((state: RootState) => state.telemetry);
  const isReplay = useSelector(
    (state: RootState) => state.playback.mode === 'playback',
  );
  // Both tokens reset this fold; Logging and the Graph accumulate history and so
  // honour only foldToken: a replayed clear must not wipe what a live run would keep.
  const foldToken = useSelector((state: RootState) => state.playback.foldToken);
  const clearToken = useSelector(
    (state: RootState) => state.playback.clearToken,
  );

  // React 18 batches the engine's empty batch with the next, so packets.length is
  // not a durable signal here.
  const seenToken = useRef(`${foldToken}:${clearToken}`);
  if (seenToken.current !== `${foldToken}:${clearToken}`) {
    seenToken.current = `${foldToken}:${clearToken}`;
    if (fold !== EMPTY) setFold(EMPTY);
  }

  // Layout, not passive: the token resets during render, so a passive effect
  // paints the empty state in between, one blank frame per seek.
  useLayoutEffect(() => {
    if (packets.length === 0) {
      setFold(EMPTY);
      return;
    }

    setFold((prev) => {
      const log = packets.reduce(
        (acc, { log: newLog }) => (newLog.length === 0 ? acc : newLog),
        prev.log,
      );

      const data = packets.reduce(
        (acc, { data: newData }) =>
          Object.keys(newData).reduce(
            (acc, k) => ({ ...acc, [k]: newData[k] }),
            acc,
          ),
        prev.data,
      );

      return { fromReplay: isReplay, data, log };
    });
  }, [packets, isReplay]);

  // Recordings are shareable files, so replayed text must never reach
  // dangerouslySetInnerHTML.
  const asHtml = !fold.fromReplay;

  const telemetryLines = Object.keys(fold.data).map((key) =>
    asHtml ? (
      <span
        key={key}
        dangerouslySetInnerHTML={{ __html: `${key}: ${fold.data[key]}<br />` }}
      />
    ) : (
      <span key={key}>
        {key}: {fold.data[key]}
        <br />
      </span>
    ),
  );

  const telemetryLog = fold.log.map((line, i) =>
    asHtml ? (
      <span key={i} dangerouslySetInnerHTML={{ __html: `${line}<br />` }} />
    ) : (
      <span key={i}>
        {line}
        <br />
      </span>
    ),
  );

  return (
    <BaseView isUnlocked={isUnlocked}>
      <BaseViewHeading isDraggable={isDraggable}>
        Telemetry
        {isReplay && <ReplayBadge source="replacing" />}
      </BaseViewHeading>
      <BaseViewBody>
        <p>{telemetryLines}</p>
        <p>{telemetryLog}</p>
      </BaseViewBody>
    </BaseView>
  );
};

export default TelemetryView;
