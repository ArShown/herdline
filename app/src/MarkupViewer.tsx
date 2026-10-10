import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { imageUrl, type OutgoingImage, type Server } from './api';
import { AuthImage } from './AuthImage';

export type ImageSource = { kind: 'remote'; path: string } | { kind: 'local'; uri: string };
export type Marked = OutgoingImage & { uri: string };

const COLORS = ['#ef4444', '#facc15', '#22c55e', '#ffffff'];
const STROKE = 4;

type Stroke = { color: string; d: string };
type Props = { server: Server; source: ImageSource | null; onClose: () => void; onAttach: (image: Marked) => void };

/** Full-screen image: pinch to zoom, or draw on it and attach the result to the next message. */
export function MarkupViewer({ server, source, onClose, onAttach }: Props) {
  const window = useWindowDimensions();
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const canvas = useRef<View>(null);
  const colorRef = useRef(color);
  colorRef.current = color;

  useEffect(() => {
    setStrokes([]);
    setDrawing(false);
    setRatio(null);
    if (!source) return;
    const onSize = (w: number, h: number) => setRatio(w / h);
    if (source.kind === 'local') Image.getSize(source.uri, onSize, () => {});
    else if (Platform.OS !== 'web') {
      Image.getSizeWithHeaders(imageUrl(server, source.path), { Authorization: `Bearer ${server.token}` }, onSize, () => {});
    }
  }, [source, server]);

  // Fit the picture inside the space left between the toolbars.
  const maxW = window.width;
  const maxH = window.height - 200;
  const size = ratio
    ? ratio > maxW / maxH
      ? { width: maxW, height: maxW / ratio }
      : { width: maxH * ratio, height: maxH }
    : { width: maxW, height: maxH };

  const pan = useMemo(() => {
    let path = '';
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        path = `M${x.toFixed(1)},${y.toFixed(1)}`;
        setCurrent(path);
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        path += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        setCurrent(path);
      },
      onPanResponderRelease: () => {
        const d = path;
        setStrokes((s) => [...s, { color: colorRef.current, d }]);
        setCurrent(null);
      },
    });
  }, []);

  const attach = async () => {
    const data = await captureRef(canvas, { format: 'jpg', quality: 0.85, result: 'base64' });
    const uri = `data:image/jpeg;base64,${data}`;
    onAttach({ uri, data, type: 'image/jpeg' });
    onClose();
  };

  const picture =
    source?.kind === 'local' ? (
      <Image source={{ uri: source.uri }} style={[size, styles.contain]} />
    ) : source ? (
      <AuthImage server={server} path={source.path} style={[size, styles.contain]} />
    ) : null;

  return (
    <Modal visible={source != null} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.wrap}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.barText}>關閉</Text>
          </Pressable>
          <Pressable onPress={() => setDrawing((d) => !d)} hitSlop={10}>
            <Text style={[styles.barText, drawing && styles.active]}>{drawing ? '標記中' : '標記'}</Text>
          </Pressable>
          <Pressable onPress={attach} disabled={strokes.length === 0} hitSlop={10}>
            <Text style={[styles.barText, { opacity: strokes.length ? 1 : 0.4 }]}>加到訊息</Text>
          </Pressable>
        </View>

        <View style={styles.stage}>
          {drawing ? (
            <View ref={canvas} collapsable={false} style={size} {...pan.panHandlers}>
              {picture}
              <Svg style={StyleSheet.absoluteFill}>
                {[...strokes, ...(current ? [{ color, d: current }] : [])].map((s, i) => (
                  <Path key={i} d={s.d} stroke={s.color} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                ))}
              </Svg>
            </View>
          ) : (
            <ScrollView
              maximumZoomScale={5}
              minimumZoomScale={1}
              centerContent
              contentContainerStyle={styles.zoom}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <View ref={canvas} collapsable={false} style={size}>
                {picture}
                <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                  {strokes.map((s, i) => (
                    <Path key={i} d={s.d} stroke={s.color} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                </Svg>
              </View>
            </ScrollView>
          )}
        </View>

        {drawing && (
          <View style={styles.tools}>
            {COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[styles.swatch, { backgroundColor: c, borderWidth: color === c ? 3 : 1 }]}
              />
            ))}
            <Pressable onPress={() => setStrokes((s) => s.slice(0, -1))} hitSlop={10}>
              <Text style={styles.barText}>復原</Text>
            </Pressable>
            <Pressable onPress={() => setStrokes([])} hitSlop={10}>
              <Text style={styles.barText}>清除</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  barText: { color: '#fff', fontSize: 16 },
  active: { color: '#f59e0b', fontWeight: '600' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  zoom: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  contain: { resizeMode: 'contain' },
  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, paddingVertical: 14 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderColor: '#fff' },
});
