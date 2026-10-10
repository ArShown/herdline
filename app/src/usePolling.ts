import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** Run `task` now and every `intervalMs` while the app is in the foreground. */
export function usePolling(task: () => Promise<void> | void, intervalMs: number) {
  const latest = useRef(task);
  latest.current = task;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      latest.current();
      timer = setInterval(() => latest.current(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [intervalMs]);
}
