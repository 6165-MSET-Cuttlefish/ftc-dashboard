import { useCallback, useEffect, useRef, useState } from 'react';

type Listener = () => void;

// Views can be added to a custom layout more than once, so every instance
// sharing a key has to see the same value. Writes notify the other instances
// directly; the `storage` event only fires for other tabs.
const listeners = new Map<string, Set<Listener>>();

function subscribe(key: string, listener: Listener): () => void {
  const forKey = listeners.get(key) ?? new Set<Listener>();
  forKey.add(listener);
  listeners.set(key, forKey);

  return () => {
    forKey.delete(listener);
    if (forKey.size === 0) listeners.delete(key);
  };
}

function notify(key: string, except: Listener) {
  listeners.get(key)?.forEach((listener) => {
    if (listener !== except) listener();
  });
}

function read<T>(key: string, fallback: T, migrate?: (raw: unknown) => T): T {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return fallback;

    const parsed = JSON.parse(stored) as unknown;
    return migrate ? migrate(parsed) : (parsed as T);
  } catch {
    // Corrupt or hand-edited storage shouldn't take the whole view down.
    return fallback;
  }
}

/**
 * `useState` backed by localStorage, kept in sync across every view instance
 * using the same key.
 *
 * @param migrate validates/upgrades whatever was previously stored. It runs on
 *   untrusted JSON, so it must tolerate any shape.
 */
export default function usePersistentState<T>(
  key: string,
  initialValue: T,
  migrate?: (raw: unknown) => T,
): [T, (update: T | ((prev: T) => T)) => void] {
  const migrateRef = useRef(migrate);
  migrateRef.current = migrate;

  const [value, setValue] = useState<T>(() => read(key, initialValue, migrate));

  // Mirrors `value` so writes can compute the next state without running side
  // effects inside a state updater.
  const valueRef = useRef(value);
  valueRef.current = value;

  const initialRef = useRef(initialValue);

  const reload = useCallback(() => {
    const next = read(key, initialRef.current, migrateRef.current);
    valueRef.current = next;
    setValue(next);
  }, [key]);

  // Switching keys should immediately surface the new key's value.
  const previousKey = useRef(key);
  useEffect(() => {
    if (previousKey.current !== key) {
      previousKey.current = key;
      reload();
    }
  }, [key, reload]);

  useEffect(() => {
    const unsubscribe = subscribe(key, reload);
    window.addEventListener('storage', reload);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', reload);
    };
  }, [key, reload]);

  const store = useCallback(
    (update: T | ((prev: T) => T)) => {
      const next =
        typeof update === 'function'
          ? (update as (prev: T) => T)(valueRef.current)
          : update;

      valueRef.current = next;
      setValue(next);

      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private browsing or a full quota; keep the in-memory value.
      }
      notify(key, reload);
    },
    [key, reload],
  );

  return [value, store];
}
