import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

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
    // iOS may report 'unknown' at launch; only a backgrounded app stops polling.
    // The web build is a preview, so it ignores tab visibility.
    const foreground = (state: string) => Platform.OS === 'web' || state !== 'background';
    if (foreground(AppState.currentState)) start();
    const sub = AppState.addEventListener('change', (state) => (foreground(state) ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [intervalMs]);
}
