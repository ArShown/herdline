import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { requestBadgePermission } from '../modules/herdline-badge';
import { api } from './api';
import { loadServer } from './settings';
import { updateUnread } from './unread';

const TASK = 'herdline.badge';
// iOS decides when to wake the app; this is only the shortest gap it may use.
const MIN_INTERVAL = 15 * 60;
// iOS ends a background run after about 30 seconds and wakes slow apps less often.
const TIMEOUT_MS = 20_000;

// Must be defined when the bundle loads: a background launch does not mount the app.
if (Platform.OS === 'ios') {
  TaskManager.defineTask(TASK, async () => {
    const server = await loadServer().catch(() => null);
    if (!server) return BackgroundFetch.BackgroundFetchResult.NoData;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const { contacts } = await api.contacts(server, abort.signal);
      const count = await updateUnread(contacts);
      return count ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Ask for the badge permission and let iOS wake the app now and then to refresh it. */
export async function startBadge(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await requestBadgePermission();
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(TASK))) {
      await BackgroundFetch.registerTaskAsync(TASK, { minimumInterval: MIN_INTERVAL });
    }
  } catch {
    // Background refresh is off for this app; the badge still updates while it is open.
  }
}
