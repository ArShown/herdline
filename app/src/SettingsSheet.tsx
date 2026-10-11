import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, ApiError, type Server } from './api';
import { saveServer } from './settings';
import { Sheet } from './Sheet';
import type { Theme } from './theme';

type Props = {
  visible: boolean;
  theme: Theme;
  server: Server;
  onClose: () => void;
  onChange: (server: Server) => void;
};

/** Connection details; the key only changes after the new one is checked against the computer. */
export function SettingsSheet({ visible, theme, server, onClose, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const close = () => {
    setEditing(false);
    setToken('');
    setError(null);
    setSaved(false);
    onClose();
  };

  const paste = async () => {
    setToken((await Clipboard.getStringAsync()).trim());
    setError(null);
  };

  const save = async () => {
    const next = { url: server.url, token: token.trim() };
    setBusy(true);
    setError(null);
    try {
      await api.contacts(next);
      await saveServer(next);
      onChange(next);
      setEditing(false);
      setToken('');
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401 ? '這組金鑰不對，原本的金鑰沒有動' : '連不上電腦，原本的金鑰沒有動',
      );
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: string) => (
    <View style={[styles.row, { backgroundColor: theme.bg }]}>
      <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );

  return (
    <Sheet visible={visible} onClose={close} style={[styles.body, { backgroundColor: theme.surface }]}>
      <View style={[styles.handle, { backgroundColor: theme.border }]} />
      <View style={styles.header}>
        <Pressable onPress={close} hitSlop={10} style={[styles.close, { borderColor: theme.border }]}>
          <Ionicons name="close" size={20} color={theme.text} />
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>設定</Text>
        <View style={styles.spacer} />
      </View>

      {row('電腦位址', server.url.replace(/^https?:\/\//, ''))}
      {row('金鑰', `••••••${server.token.slice(-4)}`)}

      {editing ? (
        <View style={styles.edit}>
          <View style={styles.tokenRow}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.bg, color: theme.text }]}
              placeholder="新的金鑰"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChangeText={setToken}
            />
            <Pressable onPress={paste} style={[styles.paste, { backgroundColor: theme.bg }]}>
              <Text style={{ color: theme.accent, fontWeight: '600' }}>貼上</Text>
            </Pressable>
          </View>
          {error && <Text style={{ color: theme.danger }}>{error}</Text>}
          <View style={styles.actions}>
            <Pressable
              style={[styles.button, { borderColor: theme.border }]}
              onPress={() => {
                setEditing(false);
                setToken('');
                setError(null);
              }}
            >
              <Text style={{ color: theme.text }}>取消</Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                {
                  backgroundColor: theme.accent,
                  borderColor: theme.accent,
                  opacity: token.trim() && !busy ? 1 : 0.5,
                },
              ]}
              disabled={!token.trim() || busy}
              onPress={save}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>確認更新</Text>}
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          style={[styles.row, styles.action, { backgroundColor: theme.bg }]}
          onPress={() => {
            setEditing(true);
            setSaved(false);
          }}
        >
          <Ionicons name="key-outline" size={18} color={theme.accent} />
          <Text style={{ color: theme.accent, fontSize: 16 }}>更新金鑰</Text>
        </Pressable>
      )}
      {saved && <Text style={{ color: theme.muted }}>金鑰已更新</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { width: 36 },
  title: { fontSize: 17, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  label: { fontSize: 14, width: 64 },
  value: { flex: 1, fontSize: 15 },
  action: { justifyContent: 'center', gap: 8 },
  edit: { gap: 10 },
  tokenRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  paste: { borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
