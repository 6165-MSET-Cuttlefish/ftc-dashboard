import { describe, expect, it } from 'vitest';

import buildFrameOrNull, {
  Frame,
} from '@/components/views/TelemetryView/buildFrame';

import { TelemetryDisplayFormat, TelemetryItem } from '@/store/types/telemetry';

// buildFrame returns null when a batch says nothing about telemetry; every test here but the
// dedicated one expects a real frame.
const buildFrame = (packets: TelemetryItem[]): Frame => {
  const frame = buildFrameOrNull(packets);
  if (frame === null) throw new Error('expected a frame, got null');
  return frame;
};

type PacketInit = Partial<TelemetryItem>;

const packet = (init: PacketInit): TelemetryItem => ({
  timestamp: 0,
  data: {},
  log: [],
  field: { ops: [] },
  fieldOverlay: { ops: [] },
  ...init,
});

const item = (caption: string | null, value: string) => ({ caption, value });

// What a path follower sends: drawing, no telemetry.
const frame = (init: PacketInit): PacketInit => ({
  telemetryFrame: true,
  ...init,
});

const overlayOnly = (): Partial<TelemetryItem> => ({
  items: [],
  log: [],
  fieldOverlay: { ops: [{ type: 'fill', color: 'red' }] },
});

const rendered = (init: PacketInit[]) =>
  buildFrame(init.map(packet)).entries.map((e) =>
    e.caption == null ? e.value : `${e.caption}: ${e.value}`,
  );

describe('ordering', () => {
  it('keeps insertion order rather than sorting', () => {
    expect(
      rendered([
        {
          items: [item('zebra', '1'), item('apple', '2'), item('Middle', '3')],
        },
      ]),
    ).toEqual(['zebra: 1', 'apple: 2', 'Middle: 3']);
  });

  it('interleaves bare lines with keyed items', () => {
    expect(
      rendered([
        {
          items: [item('a', '1'), item(null, '--- drive ---'), item('b', '2')],
        },
      ]),
    ).toEqual(['a: 1', '--- drive ---', 'b: 2']);
  });

  it('does not reorder numeric captions', () => {
    expect(
      rendered([{ items: [item('2', 'two'), item('10', 'ten')] }]),
    ).toEqual(['2: two', '10: ten']);
  });
});

describe('batching', () => {
  // A robot looping faster than the 100ms transmission interval puts several complete frames in
  // one batch. Repeating each frame's lines would be a visible defect.
  it('shows a repeated frame once, not once per packet', () => {
    const frame = {
      items: [item('a', '1'), item(null, '--- drive ---'), item('b', '2')],
      log: ['started'],
    };

    const built = buildFrame([packet(frame), packet(frame), packet(frame)]);

    expect(
      built.entries.map((e) => (e.caption == null ? e.value : e.caption)),
    ).toEqual(['a', '--- drive ---', 'b']);
    expect(built.log.map((l) => l.value)).toEqual(['started']);
  });

  it('takes values from the most recent packet', () => {
    expect(
      rendered([
        { items: [item('v', '12.1')] },
        { items: [item('v', '12.4')] },
      ]),
    ).toEqual(['v: 12.4']);
  });

  it('drops telemetry that is no longer being sent', () => {
    // Each batch is built from scratch, so a key stops being displayed one batch after the robot
    // stops sending it rather than lingering until telemetry is cleared.
    expect(
      rendered([{ items: [item('FAULT', 'overcurrent'), item('v', '12.1')] }]),
    ).toEqual(['FAULT: overcurrent', 'v: 12.1']);

    expect(rendered([{ items: [item('v', '12.4')] }])).toEqual(['v: 12.4']);
  });

  it('keeps a key dropped mid-batch until the batch after it', () => {
    // Within one batch there is no way to tell "the next loop stopped sending FAULT" apart from
    // "these two packets came from different places in the same loop", so nothing is discarded.
    expect(
      rendered([
        { items: [item('FAULT', 'overcurrent'), item('v', '12.1')] },
        { items: [item('v', '12.4')] },
      ]),
    ).toEqual(['FAULT: overcurrent', 'v: 12.4']);
  });

  it('keeps keys only an earlier packet in the batch carried', () => {
    // Several sendTelemetryPacket calls in one loop iteration is a supported idiom.
    expect(
      rendered([
        { items: [item('from-a', '1')] },
        { items: [item('from-b', '2')] },
      ]),
    ).toEqual(['from-a: 1', 'from-b: 2']);
  });

  it('keeps the bare lines of every distinct frame in a batch', () => {
    // An action packet and the op mode's own telemetry, both sent each loop. Neither one's lines
    // may be swallowed by the other.
    expect(
      rendered([
        { items: [item(null, 'STATE: scoring'), item('target', '5')] },
        { items: [item('heading', '37.5')] },
      ]),
    ).toEqual(['STATE: scoring', 'target: 5', 'heading: 37.5']);
  });

  it('does not duplicate a line that only appears on some loops', () => {
    // A conditional warning changes how many lines a frame has, but not its captions, so it is
    // still recognised as the same frame rather than shown alongside the version without it.
    expect(
      rendered([
        { items: [item('x', '1'), item(null, 'WARNING')] },
        { items: [item('x', '2')] },
      ]),
    ).toEqual(['x: 2']);
  });

  it('collapses a repeated frame whose bare line text keeps changing', () => {
    // Only the captions form a frame's shape, so a line rebuilt with a new value every loop is
    // still recognised as the same line rather than accumulating.
    expect(
      rendered([
        { items: [item(null, 't=1'), item('v', '1')] },
        { items: [item(null, 't=2'), item('v', '2')] },
        { items: [item(null, 't=3'), item('v', '3')] },
      ]),
    ).toEqual(['t=3', 'v: 3']);
  });

  it('ignores packets that carry only a field overlay', () => {
    expect(rendered([{ items: [item('a', '1')] }, overlayOnly()])).toEqual([
      'a: 1',
    ]);
  });

  it('clears the display one batch after telemetry.clear()', () => {
    // Within a batch an empty packet is indistinguishable from one that only drew something, so
    // it is ignored rather than wiping its neighbours...
    expect(
      rendered([{ items: [item('a', '1')] }, frame({ items: [], log: [] })]),
    ).toEqual(['a: 1']);

    // ...and the next batch, which carries only the empty frame, empties the view.
    expect(rendered([frame({ items: [], log: [] })])).toEqual([]);
  });

  it('is not emptied by a packet that only draws on the field', () => {
    // DashboardCore prunes such a packet's drawing away, so it arrives looking empty.
    expect(
      rendered([{ items: [item('a', '1')] }, { field: { ops: [] } }]),
    ).toEqual(['a: 1']);
  });

  it('holds telemetry through a batch of only drawing packets', () => {
    // Every Actions.runBlocking loop sends these. DashboardCore strips the ops from all but the
    // newest, so the rest arrive indistinguishable from empty — they must not blank the view.
    const pruned = { items: [], log: [], fieldOverlay: { ops: [] } };

    expect(
      buildFrameOrNull([packet(pruned), packet(pruned), packet(overlayOnly())]),
    ).toBeNull();
  });

  it('does not duplicate a separator when a conditional item splits the frame', () => {
    // The two packets are one logical frame; only the first contributes its bare line.
    expect(
      rendered([
        { items: [item('a', '1'), item(null, '--- drive ---')] },
        {
          items: [item('a', '2'), item(null, '--- drive ---'), item('b', '3')],
        },
      ]),
    ).toEqual(['a: 2', '--- drive ---', 'b: 3']);
  });

  it('leaves telemetry alone for a batch that only carried drawing', () => {
    // Otherwise the view would blank whenever a path follower drew between telemetry updates.
    expect(buildFrameOrNull([packet(overlayOnly())])).toBeNull();
  });

  // Neither frame has a caption to match on, so they are told apart by when they were sent:
  // packets queued in one loop iteration share a timestamp, a source resending each loop does
  // not. These have the same length on purpose — length alone could not separate them.
  it('keeps two bare-line-only sources from one loop side by side', () => {
    expect(
      rendered([
        { timestamp: 100, items: [item(null, 'Auto: leg 1')] },
        { timestamp: 100, items: [item(null, 'follower: running')] },
      ]),
    ).toEqual(['Auto: leg 1', 'follower: running']);
  });

  it('tracks each bare-line-only source across several loops', () => {
    expect(
      rendered([
        { timestamp: 100, items: [item(null, 'A1')] },
        { timestamp: 100, items: [item(null, 'B1')] },
        { timestamp: 120, items: [item(null, 'A2')] },
        { timestamp: 120, items: [item(null, 'B2')] },
      ]),
    ).toEqual(['A2', 'B2']);
  });

  it('separates op mode telemetry from a hand-built packet without relying on the clock', () => {
    // The common collision: telemetry.addLine() only, alongside a library packet doing the same.
    // The adapter's frames are identified by their source, so this holds even when both land in
    // the same millisecond and even when they do not.
    expect(
      rendered([
        frame({ timestamp: 100, items: [item(null, 'Auto: leg 1')] }),
        { timestamp: 100, items: [item(null, 'follower: running')] },
        frame({ timestamp: 100, items: [item(null, 'Auto: leg 2')] }),
      ]),
    ).toEqual(['Auto: leg 2', 'follower: running']);
  });

  it('collapses a bare-line-only frame resent on a later loop', () => {
    expect(
      rendered([
        { timestamp: 100, items: [item(null, 't=1')] },
        { timestamp: 120, items: [item(null, 't=2')] },
      ]),
    ).toEqual(['t=2']);
  });

  it('renders nothing for the clear signal', () => {
    const built = buildFrame([]);
    expect(built.entries).toEqual([]);
    expect(built.log).toEqual([]);
  });
});

describe('log', () => {
  it('is kept separate from the items', () => {
    const built = buildFrame([
      packet({ items: [item('a', '1')], log: ['one', 'two'] }),
    ]);

    expect(built.entries).toHaveLength(1);
    expect(built.log.map((l) => l.value)).toEqual(['one', 'two']);
  });

  it('survives another source in the batch that carries no log of its own', () => {
    // A path follower's packet has no log. Letting it win would blank the op mode's.
    const built = buildFrame([
      packet({ log: ['one'], items: [item('a', '1')] }),
      packet({ items: [item('rr', '2')] }),
    ]);

    expect(built.log.map((l) => l.value)).toEqual(['one']);
  });

  it('clears one batch after the robot stops sending it', () => {
    // The adapter retransmits the whole log with every packet, so a batch with no log at all
    // means it was cleared.
    expect(buildFrame([packet({ items: [item('a', '2')] })]).log).toEqual([]);
  });

  it('is shown for a packet that carries nothing else', () => {
    expect(
      buildFrame([packet({ log: ['one'] })]).log.map((l) => l.value),
    ).toEqual(['one']);
  });

  it('is not repeated once per packet in a batch', () => {
    const built = buildFrame([
      packet({ log: ['one'] }),
      packet({ log: ['one'] }),
    ]);

    expect(built.log.map((l) => l.value)).toEqual(['one']);
  });
});

describe('display format', () => {
  it('assumes HTML for a packet from a robot too old to declare a format', () => {
    // That version rendered markup unconditionally; assuming CLASSIC would newly show those teams
    // their own tags as literal text.
    const built = buildFrame([packet({ items: [item('a', '1')] })]);

    expect(built.entries[0].displayFormat).toBe('HTML');
  });

  it('follows each line rather than the view', () => {
    // A path follower's packets and the op mode's telemetry need not agree on a format. Resolving
    // one format for the whole view would render one of the two sources wrongly.
    const built = buildFrame([
      packet({ displayFormat: 'HTML', items: [item('rr', '<b>1</b>')] }),
      packet({ displayFormat: 'CLASSIC', items: [item('op', 'a < b')] }),
    ]);

    expect(built.entries.map((e) => [e.caption, e.displayFormat])).toEqual([
      ['rr', 'HTML'],
      ['op', 'CLASSIC'],
    ]);
  });

  it('is not reset by a packet that only carries a field overlay', () => {
    // An overlay-only packet contributes no lines, so it cannot change how the ones above it are
    // rendered.
    const built = buildFrame([
      packet({ displayFormat: 'HTML', items: [item('a', '<b>1</b>')] }),
      packet({ ...overlayOnly(), displayFormat: 'CLASSIC' }),
    ]);

    expect(built.entries[0].displayFormat).toBe('HTML');
  });

  it('takes the newest format for a caption carried by several packets', () => {
    const formats: TelemetryDisplayFormat[] = ['CLASSIC', 'HTML'];
    const built = buildFrame(
      formats.map((displayFormat) =>
        packet({ displayFormat, items: [item('a', '1')] }),
      ),
    );

    expect(built.entries[0].displayFormat).toBe('HTML');
  });

  it('applies to the log as well', () => {
    const built = buildFrame([packet({ displayFormat: 'HTML', log: ['x'] })]);

    expect(built.log[0].displayFormat).toBe('HTML');
  });
});

describe('packets from an older robot', () => {
  it('falls back to the keyed data when items is absent', () => {
    expect(rendered([{ data: { apple: '2', zebra: '1' } }])).toEqual([
      'apple: 2',
      'zebra: 1',
    ]);
  });

  it('treats an empty items array as an empty frame, not as missing', () => {
    expect(rendered([frame({ items: [], data: { a: '1' } })])).toEqual([]);
  });

  it('tolerates malformed entries', () => {
    const items = [
      null,
      'nonsense',
      { caption: 5, value: 7 },
      item('ok', '1'),
    ] as unknown as TelemetryItem['items'];

    // Non-objects are discarded; an entry with a non-string caption is treated as a bare line and
    // a non-string value as empty, so one bad entry cannot break the whole view.
    expect(rendered([{ items }])).toEqual(['', 'ok: 1']);
  });

  it('tolerates a malformed log rather than throwing out of the render', () => {
    const log = [1, null, 'ok'] as unknown as string[];

    expect(buildFrame([packet({ log })]).log.map((l) => l.value)).toEqual([
      '',
      '',
      'ok',
    ]);
  });
});
