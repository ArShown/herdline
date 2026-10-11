import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Server } from './api';

const URL_KEY = 'herdline.url';
const TOKEN_KEY = 'herdline.token';
const STORE_VERSION_KEY = 'herdline.store';
const STORE_VERSION = '2';

// The badge refresh runs in the background, often while the phone is locked, so the key must stay readable after the first unlock.
const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// SecureStore has no web implementation; the web build is only a preview, so use sessionStorage there.
const store =
  Platform.OS === 'web'
    ? {
        getItemAsync: async (key: string) => sessionStorage.getItem(key),
        setItemAsync: async (key: string, value: string) => sessionStorage.setItem(key, value),
        deleteItemAsync: async (key: string) => sessionStorage.removeItem(key),
      }
    : {
        getItemAsync: (key: string) => SecureStore.getItemAsync(key),
        // An update keeps the old lock setting, so replace the item instead.
        setItemAsync: async (key: string, value: string) => {
          await SecureStore.deleteItemAsync(key);
          await SecureStore.setItemAsync(key, value, OPTIONS);
        },
        deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key),
      };

export async function loadServer(): Promise<Server | null> {
  const [url, token] = await Promise.all([store.getItemAsync(URL_KEY), store.getItemAsync(TOKEN_KEY)]);
  return url && token ? { url, token } : null;
}

export async function saveServer(server: Server): Promise<void> {
  await store.setItemAsync(URL_KEY, server.url);
  await store.setItemAsync(TOKEN_KEY, server.token);
  await store.setItemAsync(STORE_VERSION_KEY, STORE_VERSION);
}

/** Re-save a key stored by an older version, which could only be read while the phone was unlocked. */
export async function upgradeServer(server: Server): Promise<void> {
  if ((await store.getItemAsync(STORE_VERSION_KEY)) !== STORE_VERSION) await saveServer(server);
}

export async function clearServer(): Promise<void> {
  await Promise.all([URL_KEY, TOKEN_KEY, STORE_VERSION_KEY].map((key) => store.deleteItemAsync(key)));
}
