import { useState } from 'react';
import clsx from 'clsx';

import BaseView, {
  BaseViewBody,
  BaseViewHeading,
  BaseViewHeadingProps,
  BaseViewIconButton,
  BaseViewIcons,
  BaseViewProps,
} from '@/components/views/BaseView';
import usePersistentState from '@/hooks/usePersistentState';

import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';

import ColorSettings from './ColorSettings';
import ExpectedColorPanel from './ExpectedColorPanel';
import { NormalizationMode } from './colorUtils';
import {
  SETTINGS_STORAGE_KEY,
  EXPECTED_COLOR_STORAGE_KEY,
  DEFAULT_EXPECTED,
  sanitizeExpected,
} from './expectedColor';
import useColorSensors, { displayColor } from './useColorSensors';

type ColorViewSettings = {
  mode: NormalizationMode;
  divisor: number;
};

const DEFAULT_SETTINGS: ColorViewSettings = {
  mode: 'auto',
  divisor: 1000,
};

function sanitizeSettings(raw: unknown): ColorViewSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;

  const { mode, divisor } = raw as Record<string, unknown>;
  const validModes: NormalizationMode[] = ['auto', 'byte', 'alpha', 'manual'];

  return {
    mode: validModes.includes(mode as NormalizationMode)
      ? (mode as NormalizationMode)
      : DEFAULT_SETTINGS.mode,
    divisor:
      typeof divisor === 'number' && Number.isFinite(divisor) && divisor > 0
        ? divisor
        : DEFAULT_SETTINGS.divisor,
  };
}

type ColorViewProps = BaseViewProps & BaseViewHeadingProps;

const ColorView = ({
  isDraggable = false,
  isUnlocked = false,
}: ColorViewProps) => {
  const sensors = useColorSensors();

  const [settings, setSettings] = usePersistentState(
    SETTINGS_STORAGE_KEY,
    DEFAULT_SETTINGS,
    sanitizeSettings,
  );
  const [expected, setExpected] = usePersistentState(
    EXPECTED_COLOR_STORAGE_KEY,
    DEFAULT_EXPECTED,
    sanitizeExpected,
  );

  const [showSettings, setShowSettings] = useState(false);

  // Auto-select the first sensor
  const selected = sensors[0] ?? null;

  const selectedColor =
    selected === null
      ? null
      : displayColor(selected, settings.mode, settings.divisor);

  return (
    <BaseView isUnlocked={isUnlocked}>
      <div className="flex">
        <BaseViewHeading isDraggable={isDraggable}>Color</BaseViewHeading>
        <BaseViewIcons>
          <BaseViewIconButton
            title={showSettings ? 'Hide settings' : 'Show settings'}
            className={clsx(showSettings && 'text-primary-600')}
            onClick={() => setShowSettings(!showSettings)}
          >
            <SettingsIcon className="h-6 w-6" />
          </BaseViewIconButton>
        </BaseViewIcons>
      </div>
      <BaseViewBody>
        {showSettings && (
          <ColorSettings
            mode={settings.mode}
            onModeChange={(mode) => setSettings({ ...settings, mode })}
            divisor={settings.divisor}
            onDivisorChange={(divisor) => setSettings({ ...settings, divisor })}
          />
        )}

        {sensors.length === 0 ? (
          <div className="flex-center h-full py-8 text-center">
            <div>
              <p>No color sensors detected.</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                Run the <strong>Hardware</strong> op mode with an I2C color
                sensor in your configuration to get started.
              </p>
            </div>
          </div>
        ) : selected !== null && selectedColor !== null ? (
          <ExpectedColorPanel
            expected={expected}
            onExpectedChange={setExpected}
            sensed={selectedColor}
          />
        ) : null}
      </BaseViewBody>
    </BaseView>
  );
};

export default ColorView;
