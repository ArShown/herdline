import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Contact, Server } from './src/api';
import { ChatScreen } from './src/screens/ChatScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { SwipeBack } from './src/SwipeBack';
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
  } else {
    // The chat sits on top of the list, so swiping it away shows the list underneath.
    content = (
      <View style={{ flex: 1 }}>
        <ContactsScreen server={server} onOpen={setOpen} onLogout={logout} onServerChange={setServer} />
        {open && (
          <SwipeBack onBack={() => setOpen(null)}>
            <ChatScreen server={server} contact={open} onBack={() => setOpen(null)} />
          </SwipeBack>
        )}
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          {content}
          <StatusBar style="auto" />
        </SafeAreaView>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
