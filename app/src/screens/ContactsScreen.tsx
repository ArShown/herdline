import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type Contact, type Server } from '../api';
import { formatTime } from '../format';
import { avatarColor, meterColor, statusColor, statusLabel, useTheme } from '../theme';
import { SettingsSheet } from '../SettingsSheet';
import { isUnread, onSeenChange, updateUnread } from '../unread';
import { usePolling } from '../usePolling';

type Props = {
  server: Server;
  onOpen: (contact: Contact) => void;
  onLogout: () => void;
  onServerChange: (server: Server) => void;
};

/** "Claude A 6%" -> ["Claude A", "6%"]; text without a trailing value stays whole. */
function splitUsage(part: string): [string, string] {
  const match = part.trim().match(/^(.*\S)\s+(\S+)$/);
  return match ? [match[1], match[2]] : [part.trim(), ''];
}

export function ContactsScreen({ server, onOpen, onLogout, onServerChange }: Props) {
  const theme = useTheme();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [usage, setUsage] = useState<string | null>(null);
  const [away, setAway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  // Redraw when a conversation is read, without waiting for the next poll.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onSeenChange(redraw), []);

  const load = useCallback(async () => {
    try {
      const data = await api.contacts(server);
      setContacts(data.contacts);
      updateUnread(data.contacts);
      setUsage(data.usage);
      setAway(!!data.away);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setError('連不上電腦');
    }
  }, [server, onLogout]);

  usePolling(load, 10_000);

  const createSpace = async () => {
    setCreating(true);
    try {
      const { id, name, status } = await api.createSpace(server);
      onOpen({ id, name, status, title: null, context_used: null, preview: null });
    } catch {
      setError('開不起新的 space');
    } finally {
      setCreating(false);
    }
  };

  // Title and quota stay put while the cards scroll under them.
  const titleBar = (
    <View style={styles.top}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Spaces</Text>
          {away && (
            <View style={[styles.away, { backgroundColor: theme.surface }]}>
              <Text style={[styles.awayText, { color: theme.muted }]}>🌙 夜哨</Text>
            </View>
          )}
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => setSettings(true)} hitSlop={12} style={[styles.iconButton, { backgroundColor: theme.surface }]}>
            <Ionicons name="settings-outline" size={18} color={theme.text} />
          </Pressable>
          <Pressable onPress={createSpace} disabled={creating} hitSlop={12} style={[styles.iconButton, { backgroundColor: theme.accent }]}>
            {creating ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={22} color="#fff" />}
          </Pressable>
        </View>
      </View>
      {usage && (
        <View style={styles.usage}>
          {usage.split('│').map((part) => {
            const [label, value] = splitUsage(part);
            return (
              <View key={part} style={[styles.usageCard, { backgroundColor: theme.surface }]}>
                <Text style={[styles.usageLabel, { color: theme.muted }]} numberOfLines={1}>
                  {label}
                </Text>
                <Text style={[styles.usageValue, { color: meterColor(value, theme) }]}>{value}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  const header = error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {titleBar}
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={contacts}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={36} color={theme.muted} />
            <Text style={{ color: theme.muted }}>沒有在跑的對話，按右上角開一個</Text>
          </View>
        }
        renderItem={({ item }) => {
          const ctx = item.context_used;
          return (
            <Pressable
              style={({ pressed }) => [styles.card, { backgroundColor: pressed ? theme.surface : theme.card, borderColor: theme.border }]}
              onPress={() => onOpen(item)}
            >
              <View style={[styles.avatar, { backgroundColor: avatarColor(item.name) }]}>
                <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.body}>
                <View style={styles.line}>
                  <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.when}>
                    <Text style={[styles.time, { color: theme.muted }]}>{formatTime(item.preview?.ts)}</Text>
                    {isUnread(item) && <View style={[styles.unread, { backgroundColor: theme.danger }]} />}
                  </View>
                </View>
                <Text style={[styles.preview, { color: theme.muted }]} numberOfLines={2}>
                  {item.status === 'blocked' ? '正在等你確認' : item.preview?.text ?? item.title ?? ''}
                </Text>
                <View style={styles.meta}>
                  <View style={[styles.pill, { backgroundColor: statusColor[item.status] + '22' }]}>
                    <View style={[styles.dot, { backgroundColor: statusColor[item.status] }]} />
                    <Text style={[styles.pillText, { color: statusColor[item.status] }]}>{statusLabel[item.status]}</Text>
                  </View>
                  {item.account && (
                    <Text style={[styles.account, { color: theme.muted, borderColor: theme.border }]}>{item.account}</Text>
                  )}
                  {ctx != null && (
                    <View style={styles.ctx}>
                      <View style={[styles.meter, { backgroundColor: theme.border }]}>
                        <View style={[styles.meterFill, { width: `${Math.min(ctx, 100)}%`, backgroundColor: meterColor(`${ctx}%`, theme) }]} />
                      </View>
                      <Text style={[styles.ctxText, { color: theme.muted }]}>ctx {ctx}%</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <SettingsSheet
        visible={settings}
        theme={theme}
        server={server}
        onClose={() => setSettings(false)}
        onChange={onServerChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: 14 },
  list: { flex: 1 },
  content: { paddingHorizontal: 14, paddingBottom: 24, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, paddingBottom: 6, paddingHorizontal: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  away: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  awayText: { fontSize: 13, fontWeight: '600' },
  headerTitle: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  usage: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8, paddingBottom: 12 },
  usageCard: { flexGrow: 1, minWidth: '22%', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  usageLabel: { fontSize: 11 },
  usageValue: { fontSize: 16, fontWeight: '700' },
  error: { paddingVertical: 8, textAlign: 'center' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  card: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  avatar: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 19, fontWeight: '700' },
  body: { flex: 1, gap: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: 12 },
  unread: { width: 9, height: 9, borderRadius: 5 },
  preview: { fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: '600' },
  account: { fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  ctx: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  meter: { width: 44, height: 4, borderRadius: 2, overflow: 'hidden' },
  meterFill: { height: 4, borderRadius: 2 },
  ctxText: { fontSize: 11 },
});
