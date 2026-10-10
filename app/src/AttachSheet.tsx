import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Theme } from './theme';

// Words the user types often, most used first; tapping one puts it in the message box.
export const SHORTCUTS = ['好', '可以', 'lgtm', 'welldone', '繼續', '我回來了', '夜哨', '早上好'];

type Props = {
  visible: boolean;
  theme: Theme;
  onClose: () => void;
  onPhotos: () => void;
  onFiles: () => void;
  onShortcut: (text: string) => void;
};

/** The sheet behind the composer's "+" button. */
export function AttachSheet({ visible, theme, onClose, onPhotos, onFiles, onShortcut }: Props) {
  const option = (label: string, icon: ComponentProps<typeof Ionicons>['name'], onPress: () => void) => (
    <Pressable
      style={[styles.option, { backgroundColor: theme.bg }]}
      onPress={() => {
        onClose();
        // iOS cannot open the picker while this sheet is still closing.
        setTimeout(onPress, 450);
      }}
    >
      <Ionicons name={icon} size={28} color={theme.accent} />
      <Text style={[styles.optionText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.surface }]}>
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={[styles.close, { borderColor: theme.border }]}>
            <Ionicons name="close" size={20} color={theme.text} />
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]}>加入</Text>
          <View style={styles.spacer} />
        </View>
        <View style={styles.row}>
          {option('圖片', 'image-outline', onPhotos)}
          {option('檔案', 'attach', onFiles)}
        </View>
        <View style={styles.sectionRow}>
          <Ionicons name="flash-outline" size={14} color={theme.muted} />
          <Text style={[styles.section, { color: theme.muted }]}>快捷</Text>
        </View>
        <ScrollView style={styles.shortcuts} contentContainerStyle={styles.shortcutsContent}>
          {SHORTCUTS.map((word) => (
            <Pressable
              key={word}
              style={[styles.chip, { backgroundColor: theme.bg }]}
              onPress={() => {
                onClose();
                onShortcut(word);
              }}
            >
              <Text style={{ color: theme.text, fontSize: 16 }}>{word}</Text>
              <Ionicons name="arrow-up-circle-outline" size={20} color={theme.muted} />
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingBottom: 18 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  close: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  spacer: { width: 36 },
  title: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12 },
  option: { flex: 1, borderRadius: 16, paddingVertical: 20, alignItems: 'center', gap: 6 },
  optionText: { fontSize: 16 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 20, marginBottom: 8 },
  section: { fontSize: 13 },
  shortcuts: { maxHeight: 320 },
  shortcutsContent: { gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
});
