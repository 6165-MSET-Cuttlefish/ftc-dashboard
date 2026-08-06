import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import TelemetryView from '@/components/views/TelemetryView/TelemetryView';
import { Telemetry, TelemetryItem } from '@/store/types/telemetry';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const packet = (init: Partial<TelemetryItem>): TelemetryItem => ({
  timestamp: 0,
  data: {},
  log: [],
  field: { ops: [] },
  fieldOverlay: { ops: [] },
  ...init,
});

let container: HTMLDivElement;
let root: Root;

const render = (telemetry: Telemetry) => {
  const store = createStore(() => ({ telemetry }));

  act(() => {
    root.render(
      <Provider store={store as never}>
        <TelemetryView />
      </Provider>,
    );
  });
};

const lines = () =>
  Array.from(
    container.querySelectorAll('.flex-1 > div > div'),
    (el) => el.innerHTML,
  );

// The menu animates, so each step flushes the effects the transition schedules afterwards.
const openMenuAndChoose = async (label: string) => {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button.icon-btn')?.click();
  });

  const option = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).find((b) => b.textContent?.trim().endsWith(label));

  await act(async () => {
    option?.click();
  });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('display format', () => {
  // Two sources in one batch: a path follower asking for HTML and an op mode on the default
  // Classic. They are told apart by their captions, so give them distinct ones.
  const twoSources = () => [
    packet({
      displayFormat: 'HTML',
      items: [{ caption: 'rr', value: '<b>bold</b>' }],
    }),
    packet({
      displayFormat: 'CLASSIC',
      items: [{ caption: 'op', value: 'a < b' }],
    }),
  ];

  it('renders each line in the format its own packet declared', () => {
    render(twoSources());

    expect(lines()).toEqual(['rr: <b>bold</b>', 'op: a &lt; b']);
  });

  it('overrides every line when a format is chosen', async () => {
    render(twoSources());

    await openMenuAndChoose('Classic');

    // The HTML line is now shown as the markup it actually is, which is the point of the override.
    expect(lines()).toEqual(['rr: &lt;b&gt;bold&lt;/b&gt;', 'op: a &lt; b']);
  });

  it('returns to per-packet formats when Auto is chosen again', async () => {
    render([
      packet({
        displayFormat: 'HTML',
        items: [{ caption: null, value: '<b>bold</b>' }],
      }),
    ]);

    await openMenuAndChoose('Classic');
    expect(lines()).toEqual(['&lt;b&gt;bold&lt;/b&gt;']);

    await openMenuAndChoose('Auto');
    expect(lines()).toEqual(['<b>bold</b>']);
  });

  it('names the active override in the heading, and nothing when on Auto', async () => {
    render([packet({ items: [{ caption: null, value: 'x' }] })]);

    expect(container.querySelector('h2')?.textContent).toBe('Telemetry');

    await openMenuAndChoose('Monospace');
    expect(container.querySelector('h2')?.textContent).toContain('monospace');

    await openMenuAndChoose('Auto');
    expect(container.querySelector('h2')?.textContent).toBe('Telemetry');
  });

  it('applies a monospace override to the line', async () => {
    render([packet({ items: [{ caption: null, value: 'x' }] })]);

    await openMenuAndChoose('Monospace');

    expect(container.querySelector('.flex-1 > div > div')?.className).toContain(
      'font-mono',
    );
  });
});

describe('layout', () => {
  it('puts the log below the telemetry items', () => {
    render([
      packet({
        items: [{ caption: 'a', value: '1' }],
        log: ['logged'],
      }),
    ]);

    expect(lines()).toEqual(['a: 1', 'logged']);
  });
});
