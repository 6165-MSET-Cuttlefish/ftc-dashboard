import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import LoggingView from '@/components/views/LoggingView/LoggingView';
import { STOP_OP_MODE_TAG } from '@/store/types';
import { Telemetry, TelemetryItem } from '@/store/types/telemetry';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type State = {
  status: {
    activeOpMode: string;
    activeOpModeStatus: string;
    opModeInfoList: { name: string; group: string }[];
  };
  telemetry: Telemetry;
};

let timestamp = 1000;
const packet = (init: Partial<TelemetryItem>): TelemetryItem => ({
  timestamp: (timestamp += 10),
  data: {},
  log: [],
  field: { ops: [] },
  fieldOverlay: { ops: [] },
  ...init,
});

let container: HTMLDivElement;
let root: Root;
let csv: string;

// Mounts a Logging view; each call runs an op mode sending one batch per packet,
// stops it, then downloads the CSV.
const mountRecorder = () => {
  const status = (activeOpMode: string): State['status'] => ({
    activeOpMode,
    activeOpModeStatus: 'RUNNING',
    opModeInfoList: [{ name: 'TestOp', group: 'Test' }],
  });
  const store = createStore(
    (state: State | undefined, action: { type: string; state?: State }) =>
      action.state ?? (state as State),
    { status: status('TestOp'), telemetry: [packet({ timestamp: 0 })] },
  );

  act(() => {
    root.render(
      <Provider store={store as never}>
        <LoggingView />
      </Provider>,
    );
  });

  return (packets: TelemetryItem[], opMode = 'TestOp') => {
    const running = status(opMode);
    act(() => {
      store.dispatch({
        type: 'SET',
        state: { status: running, telemetry: [] },
      });
    });

    packets.forEach((p) =>
      act(() => {
        store.dispatch({
          type: 'SET',
          state: { status: running, telemetry: [p] },
        });
      }),
    );

    act(() => {
      store.dispatch({
        type: 'SET',
        state: { status: status(STOP_OP_MODE_TAG), telemetry: [] },
      });
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('button.icon-btn')?.click();
    });

    // Time is local-timezone dependent, so each row drops its first column.
    const [header, ...rows] = csv.split('\r\n');
    return {
      header,
      rows: rows.map((row) => row.slice(row.indexOf(',') + 1)),
    };
  };
};

const record = (packets: TelemetryItem[]) => mountRecorder()(packets);

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  csv = '';
  vi.stubGlobal(
    'Blob',
    class {
      constructor(parts: string[]) {
        csv = parts.join('');
      }
    },
  );
  window.URL.createObjectURL = () => '#csv';
  window.URL.revokeObjectURL = () => undefined;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// The Telemetry adapter resends its whole retained log with every frame, numbered.
const frame = (log: string[], logRange: [number, number] | null) =>
  packet({ telemetryFrame: true, log, logRange });

describe('CSV export', () => {
  it('puts each retained log entry on the row it was added in', () => {
    const loop = (n: number, log: string[], logRange: [number, number]) =>
      packet({
        telemetryFrame: true,
        items: [{ caption: 'loop', value: `${n}` }],
        data: { loop: `${n}` },
        log,
        logRange,
      });

    const { header, rows } = record([
      loop(1, ['jammed'], [1, 1]),
      loop(2, ['jammed'], [1, 1]),
      loop(3, ['jammed', 'recovered'], [1, 2]),
      loop(4, ['jammed', 'recovered'], [1, 2]),
    ]);

    expect(header).toBe('time,loop,logs');
    expect(rows).toEqual(['1,"jammed"', '2,""', '3,"recovered"', '4,""']);
  });

  it('counts a repeated entry once per time it was added', () => {
    const { rows } = record([
      frame(['tick'], [1, 1]),
      frame(['tick', 'tick'], [1, 2]),
    ]);

    expect(rows).toEqual([',"tick"', ',"tick"']);
  });

  it('exports an entry that pushes out one with the same text', () => {
    const ticks = new Array(9).fill('tick');

    const { rows } = record([frame(ticks, [1, 9]), frame(ticks, [2, 10])]);

    expect(rows).toEqual([`,"${ticks.join('\n')}"`, ',"tick"']);
  });

  it('exports an entry added again after the log was cleared', () => {
    const { rows } = record([
      frame(['ready'], [1, 1]),
      frame(['ready'], [2, 2]),
    ]);

    expect(rows).toEqual([',"ready"', ',"ready"']);
  });

  it('numbers the next recording afresh', () => {
    const run = mountRecorder();
    run([frame(['a'], [1, 1]), frame(['a', 'b', 'c'], [1, 3])]);

    const { rows } = run(
      [frame(['x'], [1, 1]), frame(['x', 'y'], [1, 2])],
      'OtherOp',
    );

    expect(rows).toEqual([',"x"', ',"y"']);
  });

  it('reads a newest-first log from its front', () => {
    const { rows } = record([
      frame(['b', 'a'], [2, 1]),
      frame(['c', 'b', 'a'], [3, 1]),
      frame(['d', 'c', 'b'], [4, 2]),
      frame([], null),
    ]);

    expect(rows).toEqual([',"b\na"', ',"c"', ',"d"', ',""']);
  });

  it('exports bare lines in a lines column', () => {
    const { header, rows } = record([
      packet({
        telemetryFrame: true,
        items: [
          { caption: null, value: 'STATE: <font color="red">SCORE</font>' },
          { caption: 'x', value: '1' },
          { caption: null, value: 'second' },
        ],
        data: { x: '1' },
      }),
    ]);

    expect(header).toBe('time,x,lines,logs');
    expect(rows).toEqual([
      '1,"STATE: <font color=""red"">SCORE</font>\nsecond",""',
    ]);
  });

  it('exports every entry of a log with no range that fits it', () => {
    const { rows } = record([
      packet({ log: ['tick'], logRange: null }),
      packet({ log: ['tick'], logRange: null }),
      frame(['a', 'b'], [5, 5]),
    ]);

    expect(rows).toEqual([',"tick"', ',"tick"', ',"a\nb"']);
  });

  it('exports a recording from an older robot unchanged', () => {
    // Before items existed, a packet's log held only the entries added with it.
    const { header, rows } = record([
      packet({ data: { x: '1' }, log: ['tick'] }),
      packet({ data: { x: '2' }, log: ['tick'] }),
    ]);

    expect(header).toBe('time,x,logs');
    expect(rows).toEqual(['1,"tick"', '2,"tick"']);
  });
});
