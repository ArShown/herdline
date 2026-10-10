import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

/** Three pulsing dots shown while the session is working on a reply. */
export function ThinkingDots({ color, label }: { color: string; label: string }) {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        160,
        dots.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true }),
            Animated.timing(v, { toValue: 0.3, duration: 320, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots]);

  return (
    <View style={styles.row}>
      {dots.map((v, i) => (
        <Animated.View key={i} style={[styles.dot, { backgroundColor: color, opacity: v }]} />
      ))}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 10 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 13, marginLeft: 4 },
});
