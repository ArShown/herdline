import { useColorScheme } from 'react-native';
import type { Status } from './api';

const light = {
  bg: '#ffffff',
  surface: '#f2f3f5',
  text: '#111418',
  muted: '#6b7280',
  border: '#e5e7eb',
  accent: '#2563eb',
  mine: '#2563eb',
  mineText: '#ffffff',
  danger: '#dc2626',
};

const dark: typeof light = {
  bg: '#0f1115',
  surface: '#1c1f26',
  text: '#f3f4f6',
  muted: '#9ca3af',
  border: '#2a2e37',
  accent: '#60a5fa',
  mine: '#2563eb',
  mineText: '#ffffff',
  danger: '#f87171',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const statusLabel: Record<Status, string> = {
  working: '處理中',
  blocked: '等你確認',
  done: '有新回覆',
  idle: '待命',
  unknown: '未知',
};

export const statusColor: Record<Status, string> = {
  working: '#f59e0b',
  blocked: '#dc2626',
  done: '#16a34a',
  idle: '#9ca3af',
  unknown: '#9ca3af',
};
