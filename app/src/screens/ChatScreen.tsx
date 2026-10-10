import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, ApiError, type Contact, type Message, type OutgoingImage, type Server, type Status } from '../api';
import { AuthImage } from '../AuthImage';
import { Markdown } from '../Markdown';
import { statusColor, statusLabel, useTheme } from '../theme';
import { usePolling } from '../usePolling';

// Keys the bridge accepts; enough to answer a confirmation dialog.
const DIALOG_KEYS = ['1', '2', '3', 'enter', 'esc'];
const MAX_IMAGES = 6;

type Picked = OutgoingImage & { uri: string };
type Props = { server: Server; contact: Contact; onBack: () => void };

export function ChatScreen({ server, contact, onBack }: Props) {
  const theme = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>(contact.status);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

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

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - picked.length,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled) return;
    const added = result.assets
      .filter((a) => a.base64)
      .map((a) => ({ uri: a.uri, data: a.base64!, type: a.mimeType ?? 'image/jpeg' }));
    setPicked((current) => [...current, ...added].slice(0, MAX_IMAGES));
  };

  const canSend = (draft.trim() || picked.length > 0) && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await api.send(server, contact.id, draft.trim(), picked.map(({ type, data }) => ({ type, data })));
      setDraft('');
      setPicked([]);
      setStatus('working');
      await load();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'agent_blocked' ? '正在等你確認，先處理畫面上的問題' : '沒送出去');
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

  const renderImages = (images: string[] | undefined, mine: boolean) =>
    images?.length ? (
      <View style={[styles.images, mine && styles.imagesMine]}>
        {images.map((path) => (
          <Pressable key={path} onPress={() => setViewing(path)}>
            <AuthImage server={server} path={path} style={[styles.thumb, { backgroundColor: theme.surface }]} />
          </Pressable>
        ))}
      </View>
    ) : null;

  return (
    <KeyboardAvoidingView
      style={[styles.wrap, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderColor: theme.border }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={{ color: theme.text, fontSize: 26, lineHeight: 28 }}>‹</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {contact.name}
          </Text>
          <Text style={{ color: statusColor[status], fontSize: 12 }}>{statusLabel[status]}</Text>
        </View>
        <Pressable onPress={showScreen} hitSlop={12}>
          <Text style={{ color: theme.muted }}>畫面</Text>
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
        contentContainerStyle={styles.listContent}
        data={[...messages].reverse()}
        inverted
        keyExtractor={(m, i) => m.id ?? String(i)}
        renderItem={({ item }) =>
          item.role === 'user' ? (
            <View style={styles.userRow}>
              {renderImages(item.images, true)}
              {!!item.text && (
                <View style={[styles.userBubble, { backgroundColor: theme.bubble }]}>
                  <Text selectable style={[styles.userText, { color: theme.text }]}>
                    {item.text}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.assistantRow}>
              {!!item.text && <Markdown text={item.text} theme={theme} />}
              {renderImages(item.images, false)}
            </View>
          )
        }
      />

      {error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}

      <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {picked.length > 0 && (
          <ScrollView horizontal contentContainerStyle={styles.picked}>
            {picked.map((image, i) => (
              <View key={image.uri}>
                <Image source={{ uri: image.uri }} style={styles.pickedThumb} />
                <Pressable
                  style={styles.remove}
                  hitSlop={8}
                  onPress={() => setPicked((current) => current.filter((_, j) => j !== i))}
                >
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder={`回覆 ${contact.name}`}
          placeholderTextColor={theme.muted}
          multiline
          value={draft}
          onChangeText={setDraft}
        />
        <View style={styles.composerBar}>
          <Pressable
            style={[styles.round, { borderColor: theme.border }]}
            disabled={picked.length >= MAX_IMAGES}
            onPress={pickImages}
            hitSlop={6}
          >
            <Text style={{ color: theme.text, fontSize: 20, lineHeight: 22 }}>＋</Text>
          </Pressable>
          <Pressable
            style={[styles.send, { backgroundColor: canSend ? theme.accent : theme.border }]}
            disabled={!canSend}
            onPress={send}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={viewing != null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewing(null)}>
          {viewing && <AuthImage server={server} path={viewing} style={styles.viewerImage} />}
        </Pressable>
      </Modal>
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
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  banner: { padding: 10, alignItems: 'center' },
  bannerText: { color: '#fff', fontWeight: '600' },
  screen: { maxHeight: '45%', borderBottomWidth: StyleSheet.hairlineWidth },
  screenScroll: { padding: 10 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10 },
  key: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingVertical: 12 },
  userRow: { alignItems: 'flex-end', gap: 6, marginVertical: 10 },
  userBubble: { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontSize: 16, lineHeight: 23 },
  assistantRow: { gap: 8, marginVertical: 10 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  imagesMine: { justifyContent: 'flex-end' },
  thumb: { width: 150, height: 150, borderRadius: 12 },
  error: { textAlign: 'center', padding: 6 },
  composer: {
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 6,
  },
  picked: { gap: 8, paddingBottom: 4 },
  pickedThumb: { width: 64, height: 64, borderRadius: 10 },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#fff', fontSize: 14, lineHeight: 16 },
  input: { fontSize: 16, maxHeight: 140, paddingHorizontal: 4, paddingVertical: 4 },
  composerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  round: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: '#000e', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%', resizeMode: 'contain' },
});
