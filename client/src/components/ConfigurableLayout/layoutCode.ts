import { ConfigurableView } from '@/enums/ConfigurableView';

// Layout codes look like `v1;field:0,0,4,9;graph:4,0,4,9`. Each item is
// `<view>:<x>,<y>,<w>,<h>`. Keys are stable across enum reorderings.
const CODE_VERSION = 'v1';
const ITEM_SEPARATOR = ';';
const URL_PARAM = 'layout';
const MAX_ITEMS = 64;
const MAX_ROWS = 999;

const VIEW_KEYS: { [key in ConfigurableView]: string } = {
  [ConfigurableView.FIELD_VIEW]: 'field',
  [ConfigurableView.GRAPH_VIEW]: 'graph',
  [ConfigurableView.CONFIG_VIEW]: 'config',
  [ConfigurableView.TELEMETRY_VIEW]: 'telemetry',
  [ConfigurableView.HARDWARE_VIEW]: 'hardware',
  [ConfigurableView.RECORDER_VIEW]: 'recorder',
  [ConfigurableView.CAMERA_VIEW]: 'camera',
  [ConfigurableView.OPMODE_VIEW]: 'opmode',
  [ConfigurableView.LOGGING_VIEW]: 'logging',
  [ConfigurableView.HARDWARE_CONFIG_VIEW]: 'hwconfig',
  [ConfigurableView.GAMEPAD_VIEW]: 'gamepad',
  [ConfigurableView.ERROR_VIEW]: 'error',
  [ConfigurableView.LIMELIGHT_VIEW]: 'limelight',
};

const VIEWS_BY_KEY = new Map(
  Object.entries(VIEW_KEYS).map(([view, key]) => [
    key,
    Number(view) as ConfigurableView,
  ]),
);

export type SharedGridItem = {
  view: ConfigurableView;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type GridLimits = {
  cols: number;
  minW: number;
};

export type DecodeResult =
  | { ok: true; items: SharedGridItem[] }
  | { ok: false; error: string };

export function encodeLayout(items: SharedGridItem[]): string {
  return [
    CODE_VERSION,
    ...items.map(
      (item) =>
        `${VIEW_KEYS[item.view]}:${item.x},${item.y},${item.w},${item.h}`,
    ),
  ].join(ITEM_SEPARATOR);
}

function parseInteger(text: string): number | null {
  return /^\d{1,4}$/.test(text) ? Number(text) : null;
}

function malformed(segment: string): DecodeResult {
  return { ok: false, error: `Malformed entry "${segment}".` };
}

export function decodeLayout(code: string, limits: GridLimits): DecodeResult {
  const segments = extractLayoutCode(code)
    .split(ITEM_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) {
    return { ok: false, error: 'Paste a layout code or link.' };
  }
  if (segments[0].toLowerCase() !== CODE_VERSION) {
    return { ok: false, error: 'Not a layout code.' };
  }

  const itemSegments = segments.slice(1);
  if (itemSegments.length === 0) {
    return { ok: false, error: 'The layout code has no views.' };
  }
  if (itemSegments.length > MAX_ITEMS) {
    return { ok: false, error: `Layouts are limited to ${MAX_ITEMS} views.` };
  }

  const items: SharedGridItem[] = [];
  for (const segment of itemSegments) {
    const [key, rect, ...rest] = segment.split(':');
    const view = VIEWS_BY_KEY.get(key.trim().toLowerCase());
    if (view === undefined) {
      return {
        ok: false,
        error: `Unknown view "${key}". The sender's dashboard may be newer than this one.`,
      };
    }
    if (rect === undefined || rest.length > 0) {
      return malformed(segment);
    }

    const numbers = rect.split(',').map((n) => parseInteger(n.trim()));
    if (numbers.length !== 4 || numbers.some((n) => n === null)) {
      return malformed(segment);
    }
    const [x, y, w, h] = numbers as number[];

    if (w < limits.minW) {
      return {
        ok: false,
        error: `"${key}" is narrower than ${limits.minW} columns.`,
      };
    }
    if (x + w > limits.cols) {
      return { ok: false, error: `"${key}" does not fit in the grid.` };
    }
    if (h < 1 || h > MAX_ROWS) {
      return { ok: false, error: `"${key}" has an invalid height.` };
    }
    if (y > MAX_ROWS) {
      return { ok: false, error: `"${key}" is too far down the grid.` };
    }

    items.push({ view, x, y, w, h });
  }

  return { ok: true, items };
}

function safeDecodeURIComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Accepts a bare code or a full link and returns the code. Quotes and
// punctuation that chat apps wrap around links are dropped.
export function extractLayoutCode(text: string): string {
  const decoded = safeDecodeURIComponent(text.trim());
  const match = new RegExp(`(?:^|[#?&])${URL_PARAM}=([^&\\s]+)`).exec(decoded);
  return (match ? match[1] : decoded).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
}

export function buildLayoutLink(code: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${URL_PARAM}=${code}`;
}

export function readLayoutCodeFromUrl(): string | null {
  const match = new RegExp(`[#&]${URL_PARAM}=([^&]+)`).exec(
    window.location.hash,
  );
  return match ? safeDecodeURIComponent(match[1]) : null;
}

export function clearLayoutCodeFromUrl() {
  const { pathname, search, hash } = window.location;
  const params = hash
    .replace(/^#/, '')
    .split('&')
    .filter((p) => p.length > 0);
  const kept = params.filter((p) => !p.startsWith(`${URL_PARAM}=`));
  if (kept.length === params.length) return;
  const newHash = kept.length > 0 ? `#${kept.join('&')}` : '';
  window.history.replaceState(null, '', pathname + search + newHash);
}
