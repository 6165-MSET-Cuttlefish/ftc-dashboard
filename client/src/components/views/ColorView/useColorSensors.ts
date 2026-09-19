import { useSelector } from 'react-redux';

import { RootState } from '@/store/reducers';
import { HARDWARE_CATEGORY } from '@/store/reducers/config';
import { ConfigVarState, CustomVarState } from '@/store/types/config';

import { NormalizationMode, RGB, normalizeToDisplay } from './colorUtils';

export const COLOR_SENSOR_CATEGORY = 'Color Sensors';

export type ColorSensorReading = {
  name: string;
  /** Raw counts straight off the sensor; scale varies by device and gain. */
  raw: RGB;
  /** 0-1 values from NormalizedColorSensor, when the device supports it. */
  normalized: RGB | null;
  rawAlpha: number | null;
  normalizedAlpha: number | null;
  port: string | null;
};

function readNumber(
  value: Record<string, ConfigVarState>,
  key: string,
): number | null {
  const entry = value[key];
  if (entry === undefined || entry.__type === 'custom') return null;

  const raw = entry.__value;
  if (raw === null || typeof raw === 'boolean') return null;

  const parsed = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readTriple(
  value: Record<string, ConfigVarState>,
  prefix: string,
): RGB | null {
  const r = readNumber(value, `${prefix}Red`);
  const g = readNumber(value, `${prefix}Green`);
  const b = readNumber(value, `${prefix}Blue`);

  if (r === null || g === null || b === null) return null;
  return { r, g, b };
}

/**
 * The port variable is named after the hub it hangs off of, e.g.
 * "Control Hub Port" or "Expansion Hub 2 Port", so it has to be found by
 * suffix rather than by an exact key.
 */
function readPort(value: Record<string, ConfigVarState>): string | null {
  const key = Object.keys(value).find((k) => k.endsWith(' Port'));
  if (key === undefined) return null;

  const entry = value[key];
  if (entry === undefined || entry.__type === 'custom') return null;
  if (entry.__value === null) return null;

  return `${key.replace(/ Port$/, '')} port ${entry.__value}`;
}

function parseSensor(
  name: string,
  state: ConfigVarState,
): ColorSensorReading | null {
  if (state.__type !== 'custom' || state.__value === null) return null;

  const value = state.__value;
  const raw = readTriple(value, '');
  if (raw === null) return null;

  return {
    name,
    raw,
    normalized: readTriple(value, 'Normalized '),
    rawAlpha: readNumber(value, 'Alpha'),
    normalizedAlpha: readNumber(value, 'Normalized Alpha'),
    port: readPort(value),
  };
}

/**
 * Maps a reading onto a 0-255 triple suitable for display and comparison.
 * Prefers the device's own normalized output where the mode allows it, since
 * that is already corrected for the sensor's integration time.
 */
export function displayColor(
  sensor: ColorSensorReading,
  mode: NormalizationMode,
  divisor: number,
): RGB {
  switch (mode) {
    case 'byte':
      return normalizeToDisplay(sensor.raw, 'byte');
    case 'manual':
      return normalizeToDisplay(sensor.raw, 'manual', { divisor });
    case 'alpha':
      return sensor.normalized !== null
        ? normalizeToDisplay(sensor.normalized, 'alpha', {
            alpha: sensor.normalizedAlpha,
          })
        : normalizeToDisplay(sensor.raw, 'alpha', { alpha: sensor.rawAlpha });
    case 'auto':
    default:
      // Scaling to the brightest channel is ratio-preserving, so raw and
      // normalized inputs land on the same color.
      return normalizeToDisplay(sensor.normalized ?? sensor.raw, 'auto');
  }
}

/**
 * Pulls every color sensor the Hardware op mode has published out of the
 * hardware config tree. Returns an empty list when the op mode isn't running.
 */
export default function useColorSensors(): ColorSensorReading[] {
  const colorSensorRoot = useSelector((state: RootState) => {
    const configRoot = state.config.configRoot as CustomVarState;
    const hardware = configRoot.__value?.[HARDWARE_CATEGORY];
    if (hardware === undefined || hardware.__type !== 'custom') return null;

    const sensors = hardware.__value?.[COLOR_SENSOR_CATEGORY];
    if (sensors === undefined || sensors.__type !== 'custom') return null;

    return sensors.__value;
  });

  if (colorSensorRoot === null || colorSensorRoot === undefined) return [];

  return Object.keys(colorSensorRoot)
    .sort()
    .map((name) => parseSensor(name, colorSensorRoot[name]))
    .filter((sensor): sensor is ColorSensorReading => sensor !== null);
}
