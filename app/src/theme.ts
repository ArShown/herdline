import { useColorScheme } from 'react-native';
import type { Status } from './api';

// Warm neutrals and a clay accent, close to the Claude apps.
const light = {
  bg: '#faf9f5',
  surface: '#f0eee6',
  text: '#141413',
  muted: '#73726c',
  border: '#e5e3da',
  accent: '#c96442',
  bubble: '#f0eee6',
  card: '#ffffff',
  code: '#f0eee6',
  danger: '#b91c1c',
};

const dark: typeof light = {
  bg: '#262624',
  surface: '#30302e',
  text: '#f5f4ef',
  muted: '#a3a29b',
  border: '#3e3e3a',
  accent: '#d97757',
  bubble: '#141413',
  card: '#2c2c2a',
  code: '#1f1e1d',
  danger: '#f87171',
};

export type Theme = typeof light;

const AVATAR_COLORS = ['#c96442', '#5b7fd6', '#2f9e74', '#a35fc9', '#c9902b', '#2f97a8', '#d0587a'];

/** A stable color per name, so a space keeps its color. */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Color for a usage figure like "71%": calm, then amber, then red as it fills. */
export function meterColor(value: string, theme: Theme): string {
  const percent = Number.parseFloat(value);
  if (!value.endsWith('%') || Number.isNaN(percent)) return theme.text;
  if (percent >= 85) return theme.danger;
  if (percent >= 65) return '#d97706';
  return theme.text;
}

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
  working: '#d97706',
  blocked: '#dc2626',
  done: '#16a34a',
  idle: '#9ca3af',
  unknown: '#9ca3af',
};
