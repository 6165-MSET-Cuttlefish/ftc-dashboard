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

/**
 * Provenance lives with the values rather than being read from the store:
 * `state.playback.mode` flips in the commit that reduces the exit, so a separate
 * flag reads "live" for one render of recorded strings -- which would then take
 * the HTML branch below.
 */
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
  // Both tokens, because this fold resets for both reasons. foldToken is the
  // playhead moving; clearToken is a clear that was in the recording. Logging
  // and the Graph accumulate history and honour only the first, which is what
  // keeps a replayed clear from wiping a capture the live run would have kept.
  const foldToken = useSelector((state: RootState) => state.playback.foldToken);
  const clearToken = useSelector(
    (state: RootState) => state.playback.clearToken,
  );

  // React 18 batches the engine's empty batch with the one that follows it, so
  // a token rather than packets.length is the durable signal.
  const seenToken = useRef(`${foldToken}:${clearToken}`);
  if (seenToken.current !== `${foldToken}:${clearToken}`) {
    seenToken.current = `${foldToken}:${clearToken}`;
    if (fold !== EMPTY) setFold(EMPTY);
  }

  // Layout, not passive: the token reset happens during render and the refold
  // here, so a passive effect paints the empty state in between -- one blank
  // frame per seek, which during a scrub reads as flickering.
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

  // Recordings are shareable files, so replayed text never reaches
  // dangerouslySetInnerHTML. The guard is `fold.fromReplay`, written by the same
  // setter that folded the values, so it cannot disagree with the screen.
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
