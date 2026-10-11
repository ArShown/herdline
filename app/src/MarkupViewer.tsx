import Ionicons from '@expo/vector-icons/Ionicons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { imageUrl, type OutgoingImage, type Server } from './api';
import { AuthImage } from './AuthImage';

// `index` is set when the picture is one already picked for the next message, so edits replace it.
export type ImageSource = { kind: 'remote'; path: string } | { kind: 'local'; uri: string; index?: number };
export type Marked = OutgoingImage & { uri: string };

const COLORS = ['#ef4444', '#facc15', '#22c55e', '#ffffff'];
const STROKE = 4;
const HANDLE = 28; // how close to a corner a touch must start to resize from it
const MIN_CROP = 40;

type Stroke = { color: string; d: string };
type Rect = { x: number; y: number; w: number; h: number };
type Mode = 'view' | 'draw' | 'crop';
type Props = {
  server: Server;
  source: ImageSource | null;
  onClose: () => void;
  onAttach: (image: Marked, index?: number) => void;
};

/** Full-screen image: pinch to zoom, crop it or draw on it, then attach the result to the next message. */
export function MarkupViewer({ server, source, onClose, onAttach }: Props) {
  const window = useWindowDimensions();
  const [mode, setMode] = useState<Mode>('view');
  const [color, setColor] = useState(COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  // The picture after a crop; it replaces the source from then on.
  const [edited, setEdited] = useState<{ uri: string; data: string } | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [working, setWorking] = useState(false);
  const canvas = useRef<View>(null);
  const colorRef = useRef(color);
  colorRef.current = color;

  useEffect(() => {
    setStrokes([]);
    setMode('view');
    setRatio(null);
    setEdited(null);
    setCrop(null);
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
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const draw = useMemo(() => {
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

  // Drag a corner to resize the crop box, or drag inside it to move it.
  const cropRef = useRef<Rect | null>(null);
  cropRef.current = crop;
  const cropPan = useMemo(() => {
    let start: Rect = { x: 0, y: 0, w: 0, h: 0 };
    let grip: 'move' | 'tl' | 'tr' | 'bl' | 'br' = 'move';
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        start = cropRef.current ?? start;
        const { locationX: x, locationY: y } = e.nativeEvent;
        const near = (a: number, b: number) => Math.abs(a - b) < HANDLE;
        const left = near(x, start.x);
        const right = near(x, start.x + start.w);
        const top = near(y, start.y);
        const bottom = near(y, start.y + start.h);
        grip = top && left ? 'tl' : top && right ? 'tr' : bottom && left ? 'bl' : bottom && right ? 'br' : 'move';
      },
      onPanResponderMove: (_, g) => {
        const { width, height } = sizeRef.current;
        const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
        let { x, y, w, h } = start;
        if (grip === 'move') {
          x = clamp(start.x + g.dx, 0, width - w);
          y = clamp(start.y + g.dy, 0, height - h);
        } else {
          if (grip === 'tl' || grip === 'bl') {
            x = clamp(start.x + g.dx, 0, start.x + start.w - MIN_CROP);
            w = start.x + start.w - x;
          } else {
            w = clamp(start.w + g.dx, MIN_CROP, width - start.x);
          }
          if (grip === 'tl' || grip === 'tr') {
            y = clamp(start.y + g.dy, 0, start.y + start.h - MIN_CROP);
            h = start.y + start.h - y;
          } else {
            h = clamp(start.h + g.dy, MIN_CROP, height - start.y);
          }
        }
        setCrop({ x, y, w, h });
      },
    });
  }, []);

  const startCrop = () => {
    const inset = 24;
    setCrop({ x: inset, y: inset, w: size.width - inset * 2, h: size.height - inset * 2 });
    setMode('crop');
  };

  const applyCrop = async () => {
    if (!crop) return;
    setWorking(true);
    try {
      // Capture what is on screen (picture and any marks), then cut the box out at full resolution.
      const shot = await captureRef(canvas, { format: 'png', result: 'tmpfile' });
      const scale = await new Promise<number>((resolve, reject) =>
        Image.getSize(shot, (w) => resolve(w / size.width), reject),
      );
      const rendered = await ImageManipulator.manipulate(shot)
        .crop({ originX: crop.x * scale, originY: crop.y * scale, width: crop.w * scale, height: crop.h * scale })
        .renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
      setEdited({ uri: saved.uri, data: saved.base64 ?? '' });
      setRatio(saved.width / saved.height);
      setStrokes([]);
      setCrop(null);
      setMode('view');
    } finally {
      setWorking(false);
    }
  };

  const attach = async () => {
    let image: Marked;
    if (strokes.length) {
      const data = await captureRef(canvas, { format: 'jpg', quality: 0.85, result: 'base64' });
      image = { uri: `data:image/jpeg;base64,${data}`, data, type: 'image/jpeg' };
    } else if (edited) {
      image = { uri: edited.uri, data: edited.data, type: 'image/jpeg' };
    } else {
      return;
    }
    onAttach(image, source?.kind === 'local' ? source.index : undefined);
    onClose();
  };

  const changed = strokes.length > 0 || edited != null;
  const replacing = source?.kind === 'local' && source.index != null;

  const picture = edited ? (
    <Image source={{ uri: edited.uri }} style={[size, styles.contain]} />
  ) : source?.kind === 'local' ? (
    <Image source={{ uri: source.uri }} style={[size, styles.contain]} />
  ) : source ? (
    <AuthImage server={server} path={source.path} style={[size, styles.contain]} />
  ) : null;

  const marks = (live: boolean) => (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {[...strokes, ...(live && current ? [{ color, d: current }] : [])].map((s, i) => (
        <Path key={i} d={s.d} stroke={s.color} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );

  const toggle = (target: Mode, icon: 'brush' | 'crop', label: string, onEnter: () => void) => {
    const on = mode === target;
    return (
      <Pressable
        onPress={() => (on ? (setMode('view'), setCrop(null)) : onEnter())}
        hitSlop={10}
        style={[styles.toggle, on && styles.toggleOn]}
      >
        <Ionicons name={on ? icon : `${icon}-outline`} size={16} color={on ? '#000' : '#fff'} />
        <Text style={[styles.barText, on && styles.toggleOnText]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={source != null} animationType="fade" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.wrap}>
          <View style={styles.bar}>
            <Pressable onPress={onClose} hitSlop={10} style={styles.circle}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
            <View style={styles.modes}>
              {toggle('crop', 'crop', '裁切', startCrop)}
              {toggle('draw', 'brush', '標記', () => setMode('draw'))}
            </View>
            <Pressable onPress={attach} disabled={!changed || mode === 'crop'} hitSlop={10}>
              <Text style={[styles.barText, { opacity: changed && mode !== 'crop' ? 1 : 0.4 }]}>
                {replacing ? '完成' : '加到訊息'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.stage}>
            {mode === 'view' ? (
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
                  {marks(false)}
                </View>
              </ScrollView>
            ) : (
              <View style={size}>
                <View ref={canvas} collapsable={false} style={size} {...(mode === 'draw' ? draw.panHandlers : {})}>
                  {picture}
                  {marks(mode === 'draw')}
                </View>
                {mode === 'crop' && crop && (
                  <View style={StyleSheet.absoluteFill} {...cropPan.panHandlers}>
                    <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, right: 0, height: crop.y }]} />
                    <View pointerEvents="none" style={[styles.shade, { left: 0, top: crop.y + crop.h, right: 0, bottom: 0 }]} />
                    <View pointerEvents="none" style={[styles.shade, { left: 0, top: crop.y, width: crop.x, height: crop.h }]} />
                    <View
                      pointerEvents="none"
                      style={[styles.shade, { left: crop.x + crop.w, top: crop.y, right: 0, height: crop.h }]}
                    />
                    <View pointerEvents="none" style={[styles.frame, { left: crop.x, top: crop.y, width: crop.w, height: crop.h }]}>
                      <View style={[styles.corner, styles.cornerTL]} />
                      <View style={[styles.corner, styles.cornerTR]} />
                      <View style={[styles.corner, styles.cornerBL]} />
                      <View style={[styles.corner, styles.cornerBR]} />
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>

          {mode === 'draw' && (
            <View style={styles.tools}>
              {COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  style={[styles.swatch, { backgroundColor: c, borderWidth: color === c ? 3 : 1 }]}
                />
              ))}
              <Pressable onPress={() => setStrokes((s) => s.slice(0, -1))} hitSlop={10}>
                <Ionicons name="arrow-undo" size={24} color="#fff" />
              </Pressable>
              <Pressable onPress={() => setStrokes([])} hitSlop={10}>
                <Ionicons name="trash-outline" size={22} color="#fff" />
              </Pressable>
            </View>
          )}

          {mode === 'crop' && (
            <View style={styles.tools}>
              <Pressable
                onPress={() => {
                  setMode('view');
                  setCrop(null);
                }}
                hitSlop={10}
                style={styles.cropButton}
              >
                <Text style={styles.barText}>取消</Text>
              </Pressable>
              <Pressable onPress={applyCrop} disabled={working} hitSlop={10} style={[styles.cropButton, styles.toggleOn]}>
                {working ? <ActivityIndicator color="#000" /> : <Text style={[styles.barText, styles.toggleOnText]}>裁切</Text>}
              </Pressable>
            </View>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  circle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff22', alignItems: 'center', justifyContent: 'center' },
  modes: { flexDirection: 'row', gap: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#ffffff22' },
  toggleOn: { backgroundColor: '#fff' },
  toggleOnText: { color: '#000', fontWeight: '600' },
  barText: { color: '#fff', fontSize: 16 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  zoom: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  contain: { resizeMode: 'contain' },
  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, paddingVertical: 14 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderColor: '#fff' },
  shade: { position: 'absolute', backgroundColor: '#000a' },
  frame: { position: 'absolute', borderWidth: 1, borderColor: '#fff' },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: '#fff' },
  cornerTL: { left: -3, top: -3, borderLeftWidth: 4, borderTopWidth: 4 },
  cornerTR: { right: -3, top: -3, borderRightWidth: 4, borderTopWidth: 4 },
  cornerBL: { left: -3, bottom: -3, borderLeftWidth: 4, borderBottomWidth: 4 },
  cornerBR: { right: -3, bottom: -3, borderRightWidth: 4, borderBottomWidth: 4 },
  cropButton: { borderRadius: 18, paddingHorizontal: 22, paddingVertical: 10, backgroundColor: '#ffffff22', minWidth: 88, alignItems: 'center' },
});
