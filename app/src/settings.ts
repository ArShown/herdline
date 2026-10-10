import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Server } from './api';

const URL_KEY = 'herdline.url';
const TOKEN_KEY = 'herdline.token';

// SecureStore has no web implementation; the web build is only a preview, so use sessionStorage there.
const store =
  Platform.OS === 'web'
    ? {
        getItemAsync: async (key: string) => sessionStorage.getItem(key),
        setItemAsync: async (key: string, value: string) => sessionStorage.setItem(key, value),
        deleteItemAsync: async (key: string) => sessionStorage.removeItem(key),
      }
    : SecureStore;

export async function loadServer(): Promise<Server | null> {
  const [url, token] = await Promise.all([store.getItemAsync(URL_KEY), store.getItemAsync(TOKEN_KEY)]);
  return url && token ? { url, token } : null;
}

export async function saveServer(server: Server): Promise<void> {
  await store.setItemAsync(URL_KEY, server.url);
  await store.setItemAsync(TOKEN_KEY, server.token);
}

export async function clearServer(): Promise<void> {
  await Promise.all([store.deleteItemAsync(URL_KEY), store.deleteItemAsync(TOKEN_KEY)]);
}
