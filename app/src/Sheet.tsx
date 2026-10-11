import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

type Props = { visible: boolean; onClose: () => void; style?: StyleProp<ViewStyle>; children: ReactNode };

/** A bottom sheet: the dimmed backdrop fades in while only the panel slides up. */
export function Sheet({ visible, onClose, style, children }: Props) {
  const { height } = useWindowDimensions();
  const offset = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    if (!visible) return;
    offset.setValue(height);
    Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 16 }).start();
  }, [visible, height, offset]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaProvider>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={onClose} />
          <Animated.View style={{ transform: [{ translateY: offset }] }}>
            <SafeAreaView edges={['bottom']} style={[styles.sheet, style]}>
              {children}
            </SafeAreaView>
          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#0006' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingBottom: 18 },
});
