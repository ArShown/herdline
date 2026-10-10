import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError, type Server } from '../api';
import { saveServer } from '../settings';
import { useTheme } from '../theme';

export function SetupScreen({ onDone }: { onDone: (server: Server) => void }) {
  const theme = useTheme();
  const [url, setUrl] = useState('');
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
      <Text style={[styles.title, { color: theme.text }]}>連線設定</Text>
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
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
