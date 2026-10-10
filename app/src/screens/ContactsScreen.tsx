import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type Contact, type Server } from '../api';
import { formatTime } from '../format';
import { statusColor, statusLabel, useTheme } from '../theme';
import { usePolling } from '../usePolling';

const CONTEXT_WARN = 70;

type Props = {
  server: Server;
  onOpen: (contact: Contact) => void;
  onLogout: () => void;
};

export function ContactsScreen({ server, onOpen, onLogout }: Props) {
  const theme = useTheme();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setContacts(await api.contacts(server));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setError('連不上電腦');
    }
  }, [server, onLogout]);

  usePolling(load, 10_000);

  return (
    <View style={[styles.wrap, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { borderColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Spaces</Text>
        <Pressable onPress={onLogout} hitSlop={12}>
          <Text style={{ color: theme.accent }}>設定</Text>
        </Pressable>
      </View>
      {error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}
      <FlatList
        data={contacts}
        keyExtractor={(c) => c.id}
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
        ListEmptyComponent={<Text style={[styles.empty, { color: theme.muted }]}>沒有在跑的對話</Text>}
        renderItem={({ item }) => (
          <Pressable style={[styles.row, { borderColor: theme.border }]} onPress={() => onOpen(item)}>
            <View style={[styles.avatar, { backgroundColor: theme.surface }]}>
              <Text style={[styles.avatarText, { color: theme.text }]}>{item.name.slice(0, 1).toUpperCase()}</Text>
              <View style={[styles.dot, { backgroundColor: statusColor[item.status], borderColor: theme.bg }]} />
            </View>
            <View style={styles.body}>
              <View style={styles.line}>
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>{formatTime(item.preview?.ts)}</Text>
              </View>
              <Text style={{ color: theme.muted }} numberOfLines={1}>
                {item.status === 'blocked' ? '等你確認' : item.preview?.text ?? item.title ?? ''}
              </Text>
              <View style={styles.line}>
                <Text style={{ color: statusColor[item.status], fontSize: 12 }}>{statusLabel[item.status]}</Text>
                {item.context_used != null && (
                  <Text style={{ fontSize: 12, color: item.context_used >= CONTEXT_WARN ? theme.danger : theme.muted }}>
                    已用 {item.context_used}%
                  </Text>
                )}
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, fontWeight: '600' },
  error: { padding: 12, textAlign: 'center' },
  empty: { padding: 32, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '600' },
  dot: { position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
});
