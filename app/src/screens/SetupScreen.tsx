import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { api, ApiError, type Server } from '../api';
import { saveServer } from '../settings';
import { useTheme } from '../theme';

// Set in app/.env.local so the address is fixed in the build; the token is always typed on the phone.
const FIXED_URL = process.env.EXPO_PUBLIC_HERDLINE_URL ?? '';

export function SetupScreen({ onDone }: { onDone: (server: Server) => void }) {
  const theme = useTheme();
  const [url, setUrl] = useState(FIXED_URL);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const server = { url: url.trim(), token: token.trim() };
    setBusy(true);
    setError(null);
    try {
      await api.contacts(server);
      await saveServer(server);
      onDone(server);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? '金鑰不對' : '連不上，確認網址與 Tailscale 已連線');
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    setToken((await Clipboard.getStringAsync()).trim());
    setError(null);
  };

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text }];
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.wrap, { backgroundColor: theme.bg }]}
      >
        <View style={styles.brand}>
          <Image source={require('../../assets/logo.png')} style={styles.logo} />
          <Text style={[styles.title, { color: theme.text }]}>Herdline</Text>
          <Text style={{ color: theme.muted }}>輸入電腦端產生的金鑰</Text>
        </View>
        {!FIXED_URL && (
          <TextInput
            style={input}
            placeholder="https://your-mac.tailnet.ts.net"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={url}
            onChangeText={setUrl}
          />
        )}
        <View style={styles.tokenRow}>
          <TextInput
            style={[input, styles.tokenInput]}
            placeholder="金鑰"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChangeText={setToken}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />
          <Pressable onPress={paste} style={[styles.paste, { backgroundColor: theme.surface }]}>
            <Text style={{ color: theme.accent, fontWeight: '600' }}>貼上</Text>
          </Pressable>
        </View>
        {error && <Text style={{ color: theme.danger }}>{error}</Text>}
        <Pressable
          style={[styles.button, { backgroundColor: theme.accent, opacity: url && token && !busy ? 1 : 0.5 }]}
          disabled={!url || !token || busy}
          onPress={connect}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>連線</Text>}
        </Pressable>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: 8, marginBottom: 20 },
  logo: { width: 88, height: 88, borderRadius: 22, marginBottom: 6 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  tokenRow: { flexDirection: 'row', gap: 8 },
  tokenInput: { flex: 1 },
  paste: { borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
