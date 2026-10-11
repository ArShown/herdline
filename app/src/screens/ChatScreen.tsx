import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ImageLoadEventData,
  type NativeSyntheticEvent,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, type Contact, type Message, type OutgoingFile, type Server, type Status } from '../api';
import { AttachSheet } from '../AttachSheet';
import { AuthImage } from '../AuthImage';
import { loadDraft, saveDraft } from '../drafts';
import { Markdown } from '../Markdown';
import { MarkupViewer, type ImageSource, type Marked } from '../MarkupViewer';
import { Sheet } from '../Sheet';
import { useBlockSwipeBack } from '../SwipeBack';
import { ThinkingDots } from '../ThinkingDots';
import { statusColor, statusLabel, useTheme } from '../theme';
import { usePolling } from '../usePolling';

// Keys the bridge accepts; enough to move through a confirmation dialog and pick an option.
const DIALOG_KEYS: { key: string; icon?: 'arrow-up' | 'arrow-down'; label?: string }[] = [
  { key: 'up', icon: 'arrow-up' },
  { key: 'down', icon: 'arrow-down' },
  { key: 'enter', label: 'Enter' },
  { key: 'esc', label: 'Esc' },
];
const MAX_ATTACHMENTS = 6;
// Lines of command output shown before "show all".
const OUTPUT_LINES = 12;
const THUMB_HEIGHT = 160;
type Size = { width: number; height: number };

/** Thumbnail size like the Claude app: a fixed height keeping the image's shape, never enlarged past its own size. */
function fit(size: Size | undefined, maxWidth: number) {
  if (!size) return { width: THUMB_HEIGHT, height: THUMB_HEIGHT };
  const r = size.width / size.height;
  let height = Math.min(THUMB_HEIGHT, size.height);
  let width = height * r;
  if (width > maxWidth) {
    width = maxWidth;
    height = width / r;
  }
  return { width, height };
}

type Props = { server: Server; contact: Contact; onBack: () => void };

// A message on its way: shown at once, dropped when the transcript has it.
type Pending = { text: string; images: string[]; files: string[]; sentAt: number };

const PENDING_ID = 'pending';

function pendingMessage(p: Pending): Message {
  return { id: PENDING_ID, role: 'user', text: p.text, ts: new Date(p.sentAt).toISOString() };
}

/** Keep pages already scrolled back to, then the latest page from the bridge. */
function mergeLatest(current: Message[], latest: Message[]): Message[] {
  if (!latest.length) return current.length ? current : latest;
  const start = current.findIndex((m) => m.id === latest[0].id);
  return start >= 0 ? [...current.slice(0, start), ...latest] : latest;
}

export function ChatScreen({ server, contact, onBack }: Props) {
  const theme = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>(contact.status);
  const [account, setAccount] = useState<string | null>(contact.account ?? null);
  const insets = useSafeAreaInsets();
  const [initial] = useState(() => loadDraft(contact.id));
  const [draft, setDraft] = useState(initial.text);
  const [picked, setPicked] = useState<Marked[]>(initial.picked);
  const [files, setFiles] = useState<OutgoingFile[]>(initial.files);
  const [sheet, setSheet] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const firstLoad = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ImageSource | null>(null);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const { width: screenWidth } = useWindowDimensions();
  const contentWidth = screenWidth - 32;
  const measure = (key: string) => (e: NativeSyntheticEvent<ImageLoadEventData>) => {
    const { width, height } = e.nativeEvent.source ?? {};
    if (width && height && sizes[key]?.width !== width) setSizes((s) => ({ ...s, [key]: { width, height } }));
  };
  const [menu, setMenu] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [exiting, setExiting] = useState(false);
  // A command Claude suggested, waiting for the person to confirm it.
  const [confirmRun, setConfirmRun] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const commandMode = draft.trimStart().startsWith('!');
  const room = MAX_ATTACHMENTS - picked.length - files.length;
  useBlockSwipeBack(viewing != null || sheet || menu || confirmRun != null);

  const load = useCallback(async () => {
    try {
      const data = await api.messages(server, contact.id);
      setMessages((current) => mergeLatest(current, data.messages));
      if (firstLoad.current) {
        firstLoad.current = false;
        setHasMore(data.has_more);
      }
      setStatus(data.status);
      setAccount(data.account);
      setError(null);
    } catch {
      setError('連不上電腦');
    }
  }, [server, contact.id]);

  // Keep what is typed but not sent, so leaving the chat or closing the app does not lose it.
  useEffect(() => saveDraft(contact.id, { text: draft, picked, files }), [contact.id, draft, picked, files]);

  // Poll faster while a reply is on its way.
  usePolling(load, status === 'working' || sending || pending ? 2_000 : 8_000);

  // The transcript now has what was sent, so the placeholder can go.
  useEffect(() => {
    if (!pending || sending) return;
    const arrived = messages.some((m) => m.role === 'user' && Date.parse(m.ts) >= pending.sentAt - 5_000);
    if (arrived) setPending(null);
  }, [messages, pending, sending]);

  // In case the phone and computer clocks disagree, do not keep the placeholder forever.
  useEffect(() => {
    if (!pending || sending) return;
    const timer = setTimeout(() => setPending(null), 60_000);
    return () => clearTimeout(timer);
  }, [pending, sending]);

  const loadOlder = async () => {
    const first = messages[0];
    if (!hasMore || loadingOlder || !first) return;
    setLoadingOlder(true);
    try {
      const data = await api.messages(server, contact.id, first.id);
      setMessages((current) => (current[0]?.id === first.id ? [...data.messages, ...current] : current));
      setHasMore(data.has_more);
    } catch {
      setError('讀不到更早的訊息');
    } finally {
      setLoadingOlder(false);
    }
  };

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(room, 1),
      quality: 0.7,
      base64: true,
    });
    if (result.canceled) return;
    const added = result.assets
      .filter((a) => a.base64)
      .map((a) => ({ uri: a.uri, data: a.base64!, type: a.mimeType ?? 'image/jpeg' }));
    setPicked((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS - files.length));
  };

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, base64: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    const added = result.assets.filter((a) => a.base64).map((a) => ({ name: a.name, data: a.base64! }));
    setFiles((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS - picked.length));
  };

  const canSend = (draft.trim() || picked.length > 0 || files.length > 0) && !sending;

  // Show the message at once so it is clear the tap went through; `restore` puts it back if sending fails.
  const deliver = async (text: string, images: Marked[], attached: OutgoingFile[], restore?: () => void) => {
    setPending({ text, images: images.map((p) => p.uri), files: attached.map((f) => f.name), sentAt: Date.now() });
    setError(null);
    setSending(true);
    try {
      await api.send(server, contact.id, text, images.map(({ type, data }) => ({ type, data })), attached);
      setStatus('working');
      await load();
    } catch (e) {
      setPending(null);
      restore?.();
      setError(
        e instanceof ApiError && e.code === 'agent_blocked'
          ? '正在等你確認，先處理畫面上的問題，訊息沒送出'
          : e instanceof ApiError && e.code === 'busy'
            ? '他還在做事，等他停下來再執行指令'
            : e instanceof ApiError && e.code === 'command_with_attachments'
              ? '指令不能夾帶圖片或檔案'
              : restore
            ? '沒送出去，訊息放回輸入框了'
            : `「${text}」沒送出去`,
      );
    } finally {
      setSending(false);
    }
  };

  const send = () => {
    if (!canSend) return;
    const text = draft.trim();
    const outgoing = { picked, files };
    setDraft('');
    setPicked([]);
    setFiles([]);
    deliver(text, outgoing.picked, outgoing.files, () => {
      // Saved directly too, in case the chat was closed while sending.
      saveDraft(contact.id, { text, picked: outgoing.picked, files: outgoing.files });
      setDraft(text);
      setPicked(outgoing.picked);
      setFiles(outgoing.files);
    });
  };

  // A shortcut goes out on its own and leaves whatever is being typed in the box.
  const sendShortcut = (word: string) => {
    if (!sending) deliver(word, [], []);
  };

  // A suggested command runs only after the person confirms it here.
  const runConfirmed = () => {
    if (!confirmRun || sending) return;
    const command = confirmRun;
    setConfirmRun(null);
    deliver(`!${command}`, [], []);
  };

  // Esc interrupts what Claude is doing, the same as pressing it at the computer.
  const stop = async () => {
    try {
      await api.keys(server, contact.id, ['esc']);
      setTimeout(load, 600);
    } catch {
      setError('停不下來，連不上電腦');
    }
  };

  const showScreen = async () => setScreen(await api.screen(server, contact.id));

  const exit = async (force: boolean) => {
    setExiting(true);
    try {
      await api.exit(server, contact.id, force);
      setMenu(false);
      onBack();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'busy') setConfirmBusy(true);
      else setError('結束不了');
    } finally {
      setExiting(false);
    }
  };

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
          <Pressable key={path} onPress={() => setViewing({ kind: 'remote', path })}>
            <AuthImage
              server={server}
              path={path}
              onLoad={measure(path)}
              style={[styles.photo, fit(sizes[path], contentWidth * 0.75), { backgroundColor: theme.surface }]}
            />
          </Pressable>
        ))}
      </View>
    ) : null;

  const renderFiles = (names: string[] | undefined, mine: boolean) =>
    names?.length ? (
      <View style={[styles.images, mine && styles.imagesMine]}>
        {names.map((name) => (
          <View key={name} style={[styles.fileChip, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={{ color: theme.text }} numberOfLines={1}>
              <Ionicons name="document-outline" size={14} color={theme.muted} /> {name}
            </Text>
          </View>
        ))}
      </View>
    ) : null;

  return (
    <KeyboardAvoidingView
      style={[styles.wrap, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // The chat starts below the safe area, but the keyboard's position is measured from the top of the screen.
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.header, { borderColor: theme.border }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {contact.name}
          </Text>
          <View style={styles.subtitle}>
            <View style={[styles.statusDot, { backgroundColor: statusColor[status] }]} />
            <Text style={[styles.subtitleText, { color: theme.muted }]} numberOfLines={1}>
              {statusLabel[status]}
              {account ? `  ·  ${account}` : ''}
            </Text>
          </View>
        </View>
        <Pressable onPress={() => setMenu(true)} hitSlop={12}>
          <Ionicons name="ellipsis-horizontal" size={22} color={theme.text} />
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
            {DIALOG_KEYS.map(({ key, icon, label }) => (
              <Pressable key={key} style={[styles.key, { borderColor: theme.border }]} onPress={() => press(key)}>
                {icon ? <Ionicons name={icon} size={18} color={theme.text} /> : <Text style={{ color: theme.text }}>{label}</Text>}
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
        data={pending ? [pendingMessage(pending), ...[...messages].reverse()] : [...messages].reverse()}
        inverted
        onEndReached={loadOlder}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingOlder ? (
            <ActivityIndicator style={styles.older} color={theme.muted} />
          ) : !hasMore && messages.length > 0 ? (
            <Text style={[styles.olderText, { color: theme.muted }]}>沒有更早的訊息了</Text>
          ) : null
        }
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          status === 'working' && !sending ? <ThinkingDots color={theme.muted} label="思考中" /> : null
        }
        keyExtractor={(m, i) => m.id ?? String(i)}
        renderItem={({ item }) =>
          item.id === PENDING_ID && pending ? (
            <View style={[styles.userRow, styles.pendingRow]}>
              {pending.images.length > 0 && (
                <View style={[styles.images, styles.imagesMine]}>
                  {pending.images.map((uri) => (
                    <Image
                      key={uri}
                      source={{ uri }}
                      onLoad={measure(uri)}
                      style={[styles.photo, fit(sizes[uri], contentWidth * 0.75), { backgroundColor: theme.surface }]}
                    />
                  ))}
                </View>
              )}
              {renderFiles(pending.files, true)}
              {!!pending.text && (
                <View style={[styles.userBubble, { backgroundColor: theme.bubble }]}>
                  <Text style={[styles.userText, { color: theme.text }]}>{pending.text}</Text>
                </View>
              )}
              <Text style={[styles.pendingText, { color: theme.muted }]}>{sending ? '傳送中…' : '已送出'}</Text>
            </View>
          ) : item.kind === 'command' ? (
            <View style={[styles.command, { backgroundColor: theme.code, borderColor: theme.border }]}>
              <Text selectable style={[styles.commandLine, { color: theme.accent }]}>
                ! {item.text}
              </Text>
              {item.output ? (
                <Pressable
                  disabled={opened.has(item.id) || item.output.split('\n').length <= OUTPUT_LINES}
                  onPress={() => setOpened((s) => new Set(s).add(item.id))}
                >
                  <Text
                    selectable
                    numberOfLines={opened.has(item.id) ? undefined : OUTPUT_LINES}
                    style={[styles.commandOutput, { color: theme.text }]}
                  >
                    {item.output}
                  </Text>
                  {!opened.has(item.id) && item.output.split('\n').length > OUTPUT_LINES && (
                    <Text style={[styles.more, { color: theme.muted }]}>點一下看全部</Text>
                  )}
                </Pressable>
              ) : (
                <Text style={[styles.more, { color: theme.muted }]}>{status === 'working' ? '執行中…' : '沒有輸出'}</Text>
              )}
            </View>
          ) : item.role === 'user' ? (
            <View style={styles.userRow}>
              {renderImages(item.images, true)}
              {renderFiles(item.files, true)}
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
              {!!item.text && <Markdown text={item.text} theme={theme} onRun={setConfirmRun} />}
              {renderImages(item.images, false)}
              {renderFiles(item.files, false)}
            </View>
          )
        }
      />

      {error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}

      <View
        style={[styles.composer, { backgroundColor: theme.surface, borderColor: commandMode ? theme.accent : theme.border }]}
      >
        {commandMode && (
          <Text style={[styles.modeLabel, { color: theme.accent }]}>
            <Ionicons name="terminal-outline" size={12} color={theme.accent} /> 指令模式：送出後直接在電腦執行
          </Text>
        )}
        {(picked.length > 0 || files.length > 0) && (
          <ScrollView horizontal contentContainerStyle={styles.picked}>
            {files.map((file, i) => (
              <View key={`${file.name}-${i}`} style={[styles.pickedFile, { backgroundColor: theme.bg }]}>
                <Text style={{ color: theme.text, fontSize: 12 }} numberOfLines={2}>
                  <Ionicons name="document-outline" size={12} color={theme.muted} /> {file.name}
                </Text>
                <Pressable
                  style={styles.remove}
                  hitSlop={8}
                  onPress={() => setFiles((current) => current.filter((_, j) => j !== i))}
                >
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
              </View>
            ))}
            {picked.map((image, i) => (
              <View key={`${i}-${image.uri.slice(-24)}`}>
                <Pressable onPress={() => setViewing({ kind: 'local', uri: image.uri, index: i })}>
                  <Image source={{ uri: image.uri }} style={styles.pickedThumb} />
                </Pressable>
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
          style={[styles.input, { color: theme.text }, commandMode && styles.inputCommand]}
          placeholder={`回覆 ${contact.name}`}
          placeholderTextColor={theme.muted}
          multiline
          autoCapitalize={commandMode ? 'none' : 'sentences'}
          autoCorrect={!commandMode}
          value={draft}
          onChangeText={setDraft}
        />
        <View style={styles.composerBar}>
          <Pressable
            style={[styles.round, { borderColor: theme.border }]}
            onPress={() => setSheet(true)}
            hitSlop={6}
          >
            <Ionicons name="add" size={22} color={theme.text} />
          </Pressable>
          <Pressable
            style={[styles.send, { backgroundColor: canSend ? theme.accent : theme.border }]}
            disabled={!canSend}
            onPress={send}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      <Sheet
        visible={menu}
        onClose={() => {
          setMenu(false);
          setConfirmBusy(false);
        }}
        style={[styles.menu, { backgroundColor: theme.surface }]}
      >
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <Pressable
          style={[styles.menuItem, { backgroundColor: theme.bg }]}
          onPress={() => {
            setMenu(false);
            showScreen();
          }}
        >
          <Ionicons name="desktop-outline" size={20} color={theme.text} />
          <Text style={[styles.menuText, { color: theme.text }]}>看電腦畫面</Text>
        </Pressable>
        {confirmBusy ? (
          <View style={[styles.confirm, { backgroundColor: theme.bg }]}>
            <Text style={{ color: theme.text, fontSize: 15 }}>他還在做事，現在結束會中斷。確定要結束嗎？</Text>
            <View style={styles.confirmRow}>
              <Pressable style={[styles.confirmButton, { borderColor: theme.border }]} onPress={() => setConfirmBusy(false)}>
                <Text style={{ color: theme.text }}>先不要</Text>
              </Pressable>
              <Pressable style={[styles.confirmButton, { backgroundColor: theme.danger, borderColor: theme.danger }]} onPress={() => exit(true)}>
                {exiting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>結束</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={[styles.menuItem, { backgroundColor: theme.bg }]} disabled={exiting} onPress={() => exit(false)}>
            {exiting ? <ActivityIndicator /> : <Ionicons name="exit-outline" size={20} color={theme.danger} />}
            <Text style={[styles.menuText, { color: theme.danger }]}>結束對話</Text>
          </Pressable>
        )}
      </Sheet>
      <Sheet visible={confirmRun != null} onClose={() => setConfirmRun(null)} style={[styles.menu, { backgroundColor: theme.surface }]}>
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <View style={[styles.confirm, { backgroundColor: theme.bg }]}>
          <Text style={{ color: theme.text, fontSize: 15 }}>在電腦上執行這行指令？輸出會出現在對話裡。</Text>
          <ScrollView horizontal style={[styles.runPreview, { backgroundColor: theme.code }]}>
            <Text selectable style={[styles.commandLine, { color: theme.text }]}>
              ! {confirmRun}
            </Text>
          </ScrollView>
          <View style={styles.confirmRow}>
            <Pressable style={[styles.confirmButton, { borderColor: theme.border }]} onPress={() => setConfirmRun(null)}>
              <Text style={{ color: theme.text }}>取消</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmButton, { backgroundColor: theme.accent, borderColor: theme.accent }]}
              onPress={runConfirmed}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>執行</Text>
            </Pressable>
          </View>
        </View>
      </Sheet>
      <AttachSheet
        visible={sheet}
        theme={theme}
        onClose={() => setSheet(false)}
        onPhotos={() => room > 0 && pickImages()}
        onFiles={() => room > 0 && pickFiles()}
        onShortcut={sendShortcut}
        onStop={stop}
      />
      <MarkupViewer
        server={server}
        source={viewing}
        onClose={() => setViewing(null)}
        onAttach={(image, index) =>
          setPicked((current) =>
            index != null
              ? current.map((p, i) => (i === index ? image : p))
              : [...current, image].slice(0, MAX_ATTACHMENTS - files.length),
          )
        }
      />
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 3 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  subtitle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  subtitleText: { fontSize: 12 },
  banner: { padding: 10, alignItems: 'center' },
  bannerText: { color: '#fff', fontWeight: '600' },
  screen: { maxHeight: '45%', borderBottomWidth: StyleSheet.hairlineWidth },
  screenScroll: { padding: 10 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10 },
  key: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 48, alignItems: 'center' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingVertical: 12 },
  userRow: { alignItems: 'flex-end', gap: 6, marginVertical: 10 },
  pendingRow: { opacity: 0.7, marginBottom: 4 },
  pendingText: { fontSize: 12 },
  older: { paddingVertical: 16 },
  olderText: { textAlign: 'center', fontSize: 12, paddingVertical: 16 },
  userBubble: { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontSize: 16, lineHeight: 23 },
  assistantRow: { gap: 8, marginVertical: 10 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  imagesMine: { justifyContent: 'flex-end' },
  photo: { borderRadius: 12 },
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
  menu: { paddingHorizontal: 16, gap: 10 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: 6 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15 },
  menuText: { fontSize: 16 },
  confirm: { borderRadius: 14, padding: 16, gap: 14 },
  confirmRow: { flexDirection: 'row', gap: 10 },
  confirmButton: { flex: 1, alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingVertical: 12 },
  command: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6, marginVertical: 10 },
  commandLine: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, fontWeight: '600' },
  commandOutput: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, lineHeight: 17 },
  more: { fontSize: 12, marginTop: 4 },
  modeLabel: { fontSize: 12, paddingHorizontal: 4 },
  inputCommand: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 15 },
  runPreview: { borderRadius: 10, padding: 12 },
  fileChip: { maxWidth: '85%', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  pickedFile: { width: 120, height: 64, borderRadius: 10, padding: 8, justifyContent: 'center' },
});
