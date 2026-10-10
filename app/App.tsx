import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Contact, Server } from './src/api';
import { ChatScreen } from './src/screens/ChatScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { clearServer, loadServer } from './src/settings';
import { useTheme } from './src/theme';

export default function App() {
  const theme = useTheme();
  const [server, setServer] = useState<Server | null | undefined>(undefined);
  const [open, setOpen] = useState<Contact | null>(null);

  useEffect(() => {
    loadServer().then(setServer);
  }, []);

  const logout = useCallback(async () => {
    await clearServer();
    setOpen(null);
    setServer(null);
  }, []);

  let content;
  if (server === undefined) {
    content = (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  } else if (server === null) {
    content = <SetupScreen onDone={setServer} />;
  } else if (open) {
    content = <ChatScreen server={server} contact={open} onBack={() => setOpen(null)} />;
  } else {
    content = <ContactsScreen server={server} onOpen={setOpen} onLogout={logout} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        {content}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
