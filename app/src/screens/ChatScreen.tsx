import { useCallback, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, ApiError, type Contact, type Message, type Server, type Status } from '../api';
import { formatTime } from '../format';
import { statusColor, statusLabel, useTheme } from '../theme';
import { usePolling } from '../usePolling';

// Keys the bridge accepts; enough to answer a confirmation dialog.
const DIALOG_KEYS = ['1', '2', '3', 'enter', 'esc'];

type Props = { server: Server; contact: Contact; onBack: () => void };

export function ChatScreen({ server, contact, onBack }: Props) {
  const theme = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>(contact.status);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.messages(server, contact.id);
      setMessages(data.messages);
      setStatus(data.status);
      setError(null);
    } catch {
      setError('連不上電腦');
    }
  }, [server, contact.id]);

  // Poll faster while a reply is on its way.
  usePolling(load, status === 'working' || sending ? 2_000 : 8_000);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await api.send(server, contact.id, text);
      setDraft('');
      setStatus('working');
      await load();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'agent_blocked' ? '對方正在等你確認，先處理畫面上的問題' : '沒送出去');
    } finally {
      setSending(false);
    }
  };

  const showScreen = async () => setScreen(await api.screen(server, contact.id));

  const press = async (key: string) => {
    await api.keys(server, contact.id, [key]);
    setTimeout(() => {
      showScreen();
      load();
    }, 600);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.wrap, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderColor: theme.border }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={{ color: theme.accent, fontSize: 16 }}>‹ 返回</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {contact.name}
          </Text>
          <Text style={{ color: statusColor[status], fontSize: 12 }}>{statusLabel[status]}</Text>
        </View>
        <Pressable onPress={showScreen} hitSlop={12}>
          <Text style={{ color: theme.accent }}>畫面</Text>
        </Pressable>
      </View>

      {status === 'blocked' && !screen && (
        <Pressable style={[styles.banner, { backgroundColor: theme.danger }]} onPress={showScreen}>
          <Text style={styles.bannerText}>正在等你確認，點這裡看畫面</Text>
        </Pressable>
      )}

      {screen != null && (
        <View style={[styles.screen, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ScrollView style={styles.screenScroll}>
            <Text style={[styles.mono, { color: theme.text }]}>{screen}</Text>
          </ScrollView>
          <View style={styles.keys}>
            {DIALOG_KEYS.map((key) => (
              <Pressable key={key} style={[styles.key, { borderColor: theme.border }]} onPress={() => press(key)}>
                <Text style={{ color: theme.text }}>{key === 'enter' ? 'Enter' : key === 'esc' ? 'Esc' : key}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.key, { borderColor: theme.border }]} onPress={() => setScreen(null)}>
              <Text style={{ color: theme.muted }}>收起</Text>
            </Pressable>
          </View>
        </View>
      )}

      <FlatList
        style={styles.list}
        data={[...messages].reverse()}
        inverted
        keyExtractor={(m, i) => m.id ?? String(i)}
        renderItem={({ item }) => {
          const mine = item.role === 'user';
          return (
            <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
              <View style={[styles.bubble, { backgroundColor: mine ? theme.mine : theme.surface }]}>
                <Text selectable style={{ color: mine ? theme.mineText : theme.text, fontSize: 15 }}>
                  {item.text}
                </Text>
                <Text style={[styles.time, { color: mine ? theme.mineText : theme.muted }]}>{formatTime(item.ts)}</Text>
              </View>
            </View>
          );
        }}
      />

      {error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}
      <View style={[styles.composer, { borderColor: theme.border }]}>
        <TextInput
          style={[styles.input, { backgroundColor: theme.surface, color: theme.text }]}
          placeholder="輸入訊息"
          placeholderTextColor={theme.muted}
          multiline
          value={draft}
          onChangeText={setDraft}
        />
        <Pressable
          style={[styles.send, { backgroundColor: theme.accent, opacity: draft.trim() && !sending ? 1 : 0.5 }]}
          disabled={!draft.trim() || sending}
          onPress={send}
        >
          <Text style={styles.sendText}>送出</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  banner: { padding: 10, alignItems: 'center' },
  bannerText: { color: '#fff', fontWeight: '600' },
  screen: { maxHeight: '45%', borderBottomWidth: StyleSheet.hairlineWidth },
  screenScroll: { padding: 10 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10 },
  key: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  list: { flex: 1 },
  bubbleRow: { paddingHorizontal: 12, paddingVertical: 4, alignItems: 'flex-start' },
  bubbleRowMine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  time: { fontSize: 10, alignSelf: 'flex-end', opacity: 0.7 },
  error: { textAlign: 'center', padding: 6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 140 },
  send: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: '#fff', fontWeight: '600' },
});
