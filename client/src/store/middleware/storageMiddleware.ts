import { Middleware } from 'redux';
import { v4 as uuidv4 } from 'uuid';

import LayoutPreset, { LayoutPresetType } from '@/enums/LayoutPreset';
import {
  SavedLayout,
  DELETE_SAVED_LAYOUT,
  GET_LAYOUT_PRESET,
  GET_SAVED_LAYOUTS,
  LOAD_SAVED_LAYOUT,
  SAVE_LAYOUT,
  SAVE_LAYOUT_PRESET,
} from '@/store/types';
import {
  receiveLayoutPreset,
  receiveLayoutToLoad,
  receiveSavedLayouts,
} from '@/store/actions/settings';
import { RootState } from '@/store/reducers';

const LAYOUT_PRESET_KEY = 'layoutPreset';
const SAVED_LAYOUTS_KEY = 'savedLayouts';
const ACTIVE_SAVED_LAYOUT_KEY = 'activeSavedLayoutId';

const isSavedLayout = (value: unknown): value is SavedLayout =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SavedLayout).id === 'string' &&
  typeof (value as SavedLayout).name === 'string' &&
  typeof (value as SavedLayout).code === 'string';

function readSavedLayouts(): SavedLayout[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_LAYOUTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSavedLayout) : [];
  } catch {
    return [];
  }
}

function writeSavedLayouts(layouts: SavedLayout[], activeId: string | null) {
  localStorage.setItem(SAVED_LAYOUTS_KEY, JSON.stringify(layouts));
  if (activeId === null) {
    localStorage.removeItem(ACTIVE_SAVED_LAYOUT_KEY);
  } else {
    localStorage.setItem(ACTIVE_SAVED_LAYOUT_KEY, activeId);
  }
}

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const storageMiddleware: Middleware<Record<string, unknown>, RootState> =
  (store) => (next) => (action) => {
    switch (action.type) {
      case GET_LAYOUT_PRESET: {
        const preset =
          localStorage.getItem(LAYOUT_PRESET_KEY) || LayoutPreset.DEFAULT;

        store.dispatch(receiveLayoutPreset(preset as LayoutPresetType));

        break;
      }
      case SAVE_LAYOUT_PRESET: {
        localStorage.setItem(LAYOUT_PRESET_KEY, action.preset);

        store.dispatch(receiveLayoutPreset(action.preset));

        // Choosing the plain custom layout detaches it from a saved one.
        if (
          action.preset === LayoutPreset.CONFIGURABLE &&
          store.getState().settings.activeSavedLayout !== null
        ) {
          const layouts = readSavedLayouts();
          writeSavedLayouts(layouts, null);
          store.dispatch(receiveSavedLayouts(layouts, null));
        }

        break;
      }
      case GET_SAVED_LAYOUTS: {
        const layouts = readSavedLayouts();
        const storedId = localStorage.getItem(ACTIVE_SAVED_LAYOUT_KEY);
        const activeId = layouts.some((l) => l.id === storedId)
          ? storedId
          : null;

        store.dispatch(receiveSavedLayouts(layouts, activeId));

        break;
      }
      case SAVE_LAYOUT: {
        const name = action.name.trim();
        const layouts = readSavedLayouts();
        const existing = layouts.find((l) => sameName(l.name, name));
        const saved: SavedLayout = existing
          ? { ...existing, name, code: action.code }
          : { id: uuidv4(), name, code: action.code };
        const updated = existing
          ? layouts.map((l) => (l.id === saved.id ? saved : l))
          : [...layouts, saved];

        writeSavedLayouts(updated, saved.id);
        store.dispatch(receiveSavedLayouts(updated, saved.id));

        break;
      }
      case DELETE_SAVED_LAYOUT: {
        const layouts = readSavedLayouts().filter((l) => l.id !== action.id);
        const active = store.getState().settings.activeSavedLayout;
        // Another tab may have removed the active layout in the meantime.
        const activeId =
          active !== null && layouts.some((l) => l.id === active.id)
            ? active.id
            : null;

        writeSavedLayouts(layouts, activeId);
        store.dispatch(receiveSavedLayouts(layouts, activeId));

        break;
      }
      case LOAD_SAVED_LAYOUT: {
        const layouts = readSavedLayouts();
        const layout = layouts.find((l) => l.id === action.id);
        const active = store.getState().settings.activeSavedLayout;

        if (layout === undefined) {
          // Gone from another tab: refresh the list instead of doing nothing.
          const activeId =
            active !== null && layouts.some((l) => l.id === active.id)
              ? active.id
              : null;
          writeSavedLayouts(layouts, activeId);
          store.dispatch(receiveSavedLayouts(layouts, activeId));
          break;
        }

        // Coming back to the layout that is already loaded keeps any edits
        // unless the caller asked for a reload. A queued load replaces any
        // stale one. The preset is set directly: going through
        // SAVE_LAYOUT_PRESET would detach the layout being loaded.
        const alreadyActive = active !== null && active.id === layout.id;
        localStorage.setItem(LAYOUT_PRESET_KEY, LayoutPreset.CONFIGURABLE);
        store.dispatch(receiveLayoutPreset(LayoutPreset.CONFIGURABLE));
        if (action.force || !alreadyActive) {
          store.dispatch(receiveLayoutToLoad(layout.code, Date.now()));
        }
        writeSavedLayouts(layouts, layout.id);
        store.dispatch(receiveSavedLayouts(layouts, layout.id));

        break;
      }
      default:
        next(action);

        break;
    }
  };

export default storageMiddleware;
