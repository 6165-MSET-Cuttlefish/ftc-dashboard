import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import LayoutPreset, { LayoutPresetType } from '@/enums/LayoutPreset';
import { saveLayoutPreset } from '@/store/actions/settings';
import { RootState } from '@/store/reducers';

export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform);

// Alt (Option on Mac) is used as the modifier because Ctrl/Cmd + digit and
// Cmd + [ / ] are taken by browser tab and history navigation.
const MODIFIER_LABEL = isMac ? '⌥' : 'Alt';

export const MODIFIER_NOTE = isMac
  ? '⌥ is the Option key (Alt on Windows/Linux)'
  : 'Alt is ⌥ Option on Mac';

// Every preset in LayoutPreset should be listed here. Array position
// determines the digit shortcut (index 0 = Alt/Option + 1), so append new
// presets at the end to keep existing shortcuts stable. Max 9 entries.
export const PRESET_ORDER: LayoutPresetType[] = [
  LayoutPreset.DEFAULT,
  LayoutPreset.FIELD,
  LayoutPreset.GRAPH,
  LayoutPreset.HARDWARE,
  LayoutPreset.ORIGINAL,
  LayoutPreset.CONFIGURABLE,
];

export type ShortcutInfo = {
  keys: string;
  description: string;
};

export const SHORTCUTS: ShortcutInfo[] = [
  { keys: `${MODIFIER_LABEL} + ]`, description: 'Next view' },
  { keys: `${MODIFIER_LABEL} + [`, description: 'Previous view' },
  ...PRESET_ORDER.map((preset, i) => ({
    keys: `${MODIFIER_LABEL} + ${i + 1}`,
    description: `${LayoutPreset.getName(preset)} view`,
  })),
];

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

export default function useLayoutShortcuts() {
  const layoutPreset = useSelector(
    (state: RootState) => state.settings.layoutPreset,
  );
  const dispatch = useDispatch();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;

      const currentIndex = PRESET_ORDER.indexOf(
        layoutPreset as LayoutPresetType,
      );

      let nextPreset: LayoutPresetType | undefined;
      // e.code identifies the physical key so shortcuts still match on Mac,
      // where Option + key produces special characters in e.key
      if (e.code === 'BracketRight') {
        nextPreset = PRESET_ORDER[(currentIndex + 1) % PRESET_ORDER.length];
      } else if (e.code === 'BracketLeft') {
        nextPreset =
          PRESET_ORDER[
            (currentIndex - 1 + PRESET_ORDER.length) % PRESET_ORDER.length
          ];
      } else {
        const digitMatch = e.code.match(/^Digit(\d)$/);
        if (digitMatch) {
          nextPreset = PRESET_ORDER[parseInt(digitMatch[1], 10) - 1];
        }
      }

      if (nextPreset === undefined) return;

      e.preventDefault();
      dispatch(saveLayoutPreset(nextPreset));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layoutPreset, dispatch]);
}
