import * as SecureStore from 'expo-secure-store';
import type { Server } from './api';

const URL_KEY = 'herdline.url';
const TOKEN_KEY = 'herdline.token';

export async function loadServer(): Promise<Server | null> {
  const [url, token] = await Promise.all([SecureStore.getItemAsync(URL_KEY), SecureStore.getItemAsync(TOKEN_KEY)]);
  return url && token ? { url, token } : null;
}

export async function saveServer(server: Server): Promise<void> {
  await SecureStore.setItemAsync(URL_KEY, server.url);
  await SecureStore.setItemAsync(TOKEN_KEY, server.token);
}

export async function clearServer(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(URL_KEY), SecureStore.deleteItemAsync(TOKEN_KEY)]);
}
