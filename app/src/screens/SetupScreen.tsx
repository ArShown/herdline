import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text }];
  return (
    <View style={[styles.wrap, { backgroundColor: theme.bg }]}>
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: theme.accent }]}>
          <Ionicons name="chatbubbles" size={30} color="#fff" />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>herdline</Text>
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
      <TextInput
        style={input}
        placeholder="金鑰"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        value={token}
        onChangeText={setToken}
      />
      {error && <Text style={{ color: theme.danger }}>{error}</Text>}
      <Pressable
        style={[styles.button, { backgroundColor: theme.accent, opacity: url && token && !busy ? 1 : 0.5 }]}
        disabled={!url || !token || busy}
        onPress={connect}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>連線</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: 8, marginBottom: 20 },
  logo: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
